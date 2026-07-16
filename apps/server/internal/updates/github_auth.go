package updates

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var (
	ErrGitHubAuthUnavailable   = errors.New("GitHub sign-in is not configured")
	ErrGitHubAuthFlow          = errors.New("GitHub sign-in request was not found or has expired")
	ErrGitHubAuthManaged       = errors.New("GitHub authentication is managed by TILECAST_GITHUB_TOKEN")
	ErrGitHubClientIDInvalid   = errors.New("GitHub OAuth client ID is invalid")
	ErrGitHubClientIDManaged   = errors.New("GitHub OAuth client ID is managed by TILECAST_GITHUB_CLIENT_ID")
	ErrGitHubClientIDConnected = errors.New("disconnect GitHub before changing its OAuth client ID")
)

type githubDeviceProvider interface {
	BeginDeviceAuthorization(context.Context, string) (DeviceAuthorization, error)
	PollDeviceAuthorization(context.Context, string, string) (DeviceTokenResult, error)
	Viewer(context.Context, string) (string, error)
	SetToken(string)
}

type GitHubAuthStatus struct {
	Available     bool   `json:"available"`
	Connected     bool   `json:"connected"`
	Source        string `json:"source"`
	Login         string `json:"login,omitempty"`
	CanDisconnect bool   `json:"canDisconnect"`
}

type GitHubDeviceStart struct {
	FlowID              string    `json:"flowId"`
	UserCode            string    `json:"userCode"`
	VerificationURI     string    `json:"verificationUri"`
	ExpiresAt           time.Time `json:"expiresAt"`
	PollIntervalSeconds int       `json:"pollIntervalSeconds"`
}

type GitHubDevicePoll struct {
	Status            string `json:"status"`
	Login             string `json:"login,omitempty"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

type githubAuthorization struct {
	provider        githubDeviceProvider
	clientID        string
	clientIDPath    string
	clientIDManaged bool
	credential      string
	environment     bool

	mu        sync.Mutex
	connected bool
	login     string
	flows     map[string]*githubDeviceFlow
}

type githubDeviceFlow struct {
	deviceCode  string
	expiresAt   time.Time
	interval    time.Duration
	nextPoll    time.Time
	polling     bool
	accessToken string
}

type githubCredential struct {
	AccessToken string `json:"accessToken"`
	Login       string `json:"login"`
}

type githubClientConfiguration struct {
	ClientID string `json:"clientId"`
}

func newGitHubAuthorization(provider Provider, root, clientID string, environment bool) (*githubAuthorization, error) {
	deviceProvider, ok := provider.(githubDeviceProvider)
	clientID = strings.TrimSpace(clientID)
	if clientID != "" && !validGitHubClientID(clientID) {
		return nil, errors.New("TILECAST_GITHUB_CLIENT_ID is invalid")
	}
	auth := &githubAuthorization{
		provider:        deviceProvider,
		clientID:        clientID,
		clientIDPath:    filepath.Join(root, "github-oauth-client.json"),
		clientIDManaged: clientID != "",
		credential:      filepath.Join(root, "github-oauth.json"),
		environment:     environment,
		connected:       environment,
		flows:           map[string]*githubDeviceFlow{},
	}
	if !auth.clientIDManaged {
		configuration, err := readGitHubClientConfiguration(auth.clientIDPath)
		switch {
		case errors.Is(err, os.ErrNotExist):
		case err != nil:
			return nil, fmt.Errorf("read persisted GitHub OAuth configuration: %w", err)
		default:
			auth.clientID = configuration.ClientID
		}
	}
	if environment || !ok {
		return auth, nil
	}
	credential, err := readGitHubCredential(auth.credential)
	if errors.Is(err, os.ErrNotExist) {
		return auth, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read persisted GitHub authorization: %w", err)
	}
	if credential.AccessToken != "" {
		deviceProvider.SetToken(credential.AccessToken)
		auth.connected = true
		auth.login = credential.Login
	}
	return auth, nil
}

func validGitHubClientID(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '.' && character != '_' && character != '-' {
			return false
		}
	}
	return true
}

func (s *Service) ConfigureGitHubClientID(clientID string) error {
	auth := s.github
	if auth == nil || auth.provider == nil || auth.environment {
		return ErrGitHubAuthUnavailable
	}
	clientID = strings.TrimSpace(clientID)
	if !validGitHubClientID(clientID) {
		return ErrGitHubClientIDInvalid
	}
	auth.mu.Lock()
	defer auth.mu.Unlock()
	if auth.clientIDManaged {
		return ErrGitHubClientIDManaged
	}
	if auth.connected {
		return ErrGitHubClientIDConnected
	}
	if auth.clientID == clientID {
		return nil
	}
	if err := writeGitHubClientConfiguration(auth.clientIDPath, githubClientConfiguration{ClientID: clientID}); err != nil {
		return fmt.Errorf("persist GitHub OAuth configuration: %w", err)
	}
	auth.clientID = clientID
	auth.flows = map[string]*githubDeviceFlow{}
	return nil
}

func (s *Service) GitHubAuthStatus() GitHubAuthStatus {
	if s.github == nil {
		return GitHubAuthStatus{Source: "anonymous"}
	}
	s.github.mu.Lock()
	defer s.github.mu.Unlock()
	status := GitHubAuthStatus{
		Available: s.github.provider != nil && s.github.clientID != "" && !s.github.environment,
		Connected: s.github.connected,
		Login:     s.github.login,
		Source:    "anonymous",
	}
	if s.github.environment {
		status.Source = "environment"
	} else if s.github.connected {
		status.Source = "device"
		status.CanDisconnect = true
	}
	return status
}

func (s *Service) BeginGitHubDeviceAuthorization(ctx context.Context) (GitHubDeviceStart, error) {
	auth := s.github
	if auth == nil || auth.provider == nil || auth.environment {
		return GitHubDeviceStart{}, ErrGitHubAuthUnavailable
	}
	auth.mu.Lock()
	clientID := auth.clientID
	auth.mu.Unlock()
	if clientID == "" {
		return GitHubDeviceStart{}, ErrGitHubAuthUnavailable
	}
	device, err := auth.provider.BeginDeviceAuthorization(ctx, clientID)
	if err != nil {
		return GitHubDeviceStart{}, err
	}
	now := time.Now().UTC()
	flowID := uuid.NewString()
	auth.mu.Lock()
	for id, flow := range auth.flows {
		if now.After(flow.expiresAt) {
			delete(auth.flows, id)
		}
	}
	if len(auth.flows) >= 8 {
		auth.mu.Unlock()
		return GitHubDeviceStart{}, errors.New("too many GitHub sign-in requests are active")
	}
	auth.flows[flowID] = &githubDeviceFlow{deviceCode: device.DeviceCode, expiresAt: now.Add(device.ExpiresIn), interval: device.Interval, nextPoll: now.Add(device.Interval)}
	auth.mu.Unlock()
	return GitHubDeviceStart{FlowID: flowID, UserCode: device.UserCode, VerificationURI: device.VerificationURI, ExpiresAt: now.Add(device.ExpiresIn), PollIntervalSeconds: int(device.Interval / time.Second)}, nil
}

func (s *Service) PollGitHubDeviceAuthorization(ctx context.Context, flowID string) (GitHubDevicePoll, error) {
	auth := s.github
	if auth == nil || auth.provider == nil || auth.environment {
		return GitHubDevicePoll{}, ErrGitHubAuthUnavailable
	}
	auth.mu.Lock()
	clientID := auth.clientID
	if clientID == "" {
		auth.mu.Unlock()
		return GitHubDevicePoll{}, ErrGitHubAuthUnavailable
	}
	flow, ok := auth.flows[flowID]
	now := time.Now().UTC()
	if !ok || (flow.accessToken == "" && now.After(flow.expiresAt)) {
		delete(auth.flows, flowID)
		auth.mu.Unlock()
		return GitHubDevicePoll{}, ErrGitHubAuthFlow
	}
	if flow.polling {
		retry := retrySeconds(now, flow.nextPoll)
		auth.mu.Unlock()
		return GitHubDevicePoll{Status: "pending", RetryAfterSeconds: retry}, nil
	}
	if flow.accessToken == "" && now.Before(flow.nextPoll) {
		retry := retrySeconds(now, flow.nextPoll)
		auth.mu.Unlock()
		return GitHubDevicePoll{Status: "pending", RetryAfterSeconds: retry}, nil
	}
	flow.polling = true
	deviceCode := flow.deviceCode
	accessToken := flow.accessToken
	auth.mu.Unlock()

	if accessToken == "" {
		result, err := auth.provider.PollDeviceAuthorization(ctx, clientID, deviceCode)
		if err != nil {
			auth.finishPoll(flowID, "", false)
			return GitHubDevicePoll{}, err
		}
		if result.Status == "denied" || result.Status == "expired" {
			auth.mu.Lock()
			delete(auth.flows, flowID)
			auth.mu.Unlock()
			return GitHubDevicePoll{Status: result.Status}, nil
		}
		if result.Status == "pending" {
			auth.finishPoll(flowID, "", result.SlowDown)
			auth.mu.Lock()
			flow = auth.flows[flowID]
			retry := retrySeconds(time.Now().UTC(), flow.nextPoll)
			auth.mu.Unlock()
			return GitHubDevicePoll{Status: "pending", RetryAfterSeconds: retry}, nil
		}
		accessToken = result.AccessToken
		auth.finishPoll(flowID, accessToken, false)
	}

	login, err := auth.provider.Viewer(ctx, accessToken)
	if err != nil {
		auth.finishPoll(flowID, accessToken, false)
		return GitHubDevicePoll{}, err
	}
	if err := writeGitHubCredential(auth.credential, githubCredential{AccessToken: accessToken, Login: login}); err != nil {
		auth.finishPoll(flowID, accessToken, false)
		return GitHubDevicePoll{}, fmt.Errorf("persist GitHub authorization: %w", err)
	}
	auth.provider.SetToken(accessToken)
	auth.mu.Lock()
	auth.connected = true
	auth.login = login
	delete(auth.flows, flowID)
	auth.mu.Unlock()
	return GitHubDevicePoll{Status: "connected", Login: login}, nil
}

func (a *githubAuthorization) finishPoll(flowID, accessToken string, slowDown bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	flow, ok := a.flows[flowID]
	if !ok {
		return
	}
	flow.polling = false
	if accessToken != "" {
		flow.accessToken = accessToken
	}
	if slowDown {
		flow.interval += 5 * time.Second
	}
	flow.nextPoll = time.Now().UTC().Add(flow.interval)
}

func (s *Service) DisconnectGitHub() error {
	auth := s.github
	if auth == nil || auth.provider == nil {
		return ErrGitHubAuthUnavailable
	}
	if auth.environment {
		return ErrGitHubAuthManaged
	}
	if err := os.Remove(auth.credential); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove GitHub authorization: %w", err)
	}
	auth.provider.SetToken("")
	auth.mu.Lock()
	auth.connected = false
	auth.login = ""
	auth.flows = map[string]*githubDeviceFlow{}
	auth.mu.Unlock()
	return nil
}

func retrySeconds(now, next time.Time) int {
	remaining := next.Sub(now)
	if remaining <= 0 {
		return 1
	}
	return int((remaining + time.Second - 1) / time.Second)
}

func readGitHubClientConfiguration(path string) (githubClientConfiguration, error) {
	file, err := os.Open(path)
	if err != nil {
		return githubClientConfiguration{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return githubClientConfiguration{}, errors.New("GitHub OAuth configuration file must be a regular owner-only file")
	}
	var configuration githubClientConfiguration
	decoder := json.NewDecoder(io.LimitReader(file, 4<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&configuration); err != nil || decoder.Decode(&struct{}{}) != io.EOF || !validGitHubClientID(strings.TrimSpace(configuration.ClientID)) {
		return githubClientConfiguration{}, errors.New("GitHub OAuth configuration file is invalid")
	}
	configuration.ClientID = strings.TrimSpace(configuration.ClientID)
	return configuration, nil
}

func writeGitHubClientConfiguration(path string, configuration githubClientConfiguration) error {
	configuration.ClientID = strings.TrimSpace(configuration.ClientID)
	if !validGitHubClientID(configuration.ClientID) {
		return ErrGitHubClientIDInvalid
	}
	return writeOwnerOnlyJSON(path, configuration)
}

func readGitHubCredential(path string) (githubCredential, error) {
	file, err := os.Open(path)
	if err != nil {
		return githubCredential{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return githubCredential{}, errors.New("credential file must be a regular owner-only file")
	}
	var credential githubCredential
	decoder := json.NewDecoder(io.LimitReader(file, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&credential); err != nil || decoder.Decode(&struct{}{}) != io.EOF || !validGitHubAccessToken(credential.AccessToken) || strings.TrimSpace(credential.Login) == "" {
		return githubCredential{}, errors.New("credential file is invalid")
	}
	return credential, nil
}

func writeGitHubCredential(path string, credential githubCredential) error {
	return writeOwnerOnlyJSON(path, credential)
}

func writeOwnerOnlyJSON(path string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	temporary := path + "." + uuid.NewString() + ".tmp"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(payload)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		_ = os.Remove(temporary)
		return errors.New("configuration file could not be written")
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
