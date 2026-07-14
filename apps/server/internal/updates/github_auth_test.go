package updates

import (
	"context"
	"errors"
	"net/http"
	"os"
	"testing"
	"time"
)

type authTestProvider struct {
	token string
	polls int
}

func (p *authTestProvider) Releases(context.Context, string) (ProviderResult, error) {
	return ProviderResult{}, nil
}
func (p *authTestProvider) Download(context.Context, string, int64) ([]byte, error) {
	return nil, errors.New("not implemented")
}
func (p *authTestProvider) Open(context.Context, string) (*http.Response, error) {
	return nil, errors.New("not implemented")
}
func (p *authTestProvider) BeginDeviceAuthorization(context.Context, string) (DeviceAuthorization, error) {
	return DeviceAuthorization{DeviceCode: "device-secret", UserCode: "ABCD-EFGH", VerificationURI: "https://github.com/login/device", ExpiresIn: 15 * time.Minute, Interval: 5 * time.Second}, nil
}
func (p *authTestProvider) PollDeviceAuthorization(context.Context, string, string) (DeviceTokenResult, error) {
	p.polls++
	return DeviceTokenResult{AccessToken: "access-secret", Status: "connected"}, nil
}
func (p *authTestProvider) Viewer(context.Context, string) (string, error) {
	return "tilecast-owner", nil
}
func (p *authTestProvider) SetToken(token string) { p.token = token }

func TestGitHubDeviceAuthorizationPersistsAndReloadsCredential(t *testing.T) {
	root := t.TempDir()
	provider := &authTestProvider{}
	service, err := NewService(nil, provider, Config{Root: root, MaxAPKBytes: 1024, GitHubClientID: "client-123"})
	if err != nil {
		t.Fatal(err)
	}
	if status := service.GitHubAuthStatus(); !status.Available || status.Connected {
		t.Fatalf("initial status: %#v", status)
	}
	start, err := service.BeginGitHubDeviceAuthorization(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if start.FlowID == "" || start.UserCode != "ABCD-EFGH" || start.VerificationURI != "https://github.com/login/device" {
		t.Fatalf("start response: %#v", start)
	}
	service.github.mu.Lock()
	service.github.flows[start.FlowID].nextPoll = time.Now().Add(-time.Second)
	service.github.mu.Unlock()
	result, err := service.PollGitHubDeviceAuthorization(t.Context(), start.FlowID)
	if err != nil || result.Status != "connected" || result.Login != "tilecast-owner" {
		t.Fatalf("poll result=%#v err=%v", result, err)
	}
	if provider.token != "access-secret" {
		t.Fatal("provider did not receive access token")
	}
	info, err := os.Stat(service.github.credential)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("credential mode=%v", info.Mode().Perm())
	}

	restartedProvider := &authTestProvider{}
	restarted, err := NewService(nil, restartedProvider, Config{Root: root, MaxAPKBytes: 1024, GitHubClientID: "client-123"})
	if err != nil {
		t.Fatal(err)
	}
	status := restarted.GitHubAuthStatus()
	if !status.Connected || status.Login != "tilecast-owner" || status.Source != "device" || restartedProvider.token != "access-secret" {
		t.Fatalf("restarted status=%#v tokenSet=%t", status, restartedProvider.token != "")
	}
	if err := restarted.DisconnectGitHub(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(restarted.github.credential); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("credential still exists: %v", err)
	}
}

func TestEnvironmentGitHubTokenCannotBeDisconnected(t *testing.T) {
	service, err := NewService(nil, &authTestProvider{}, Config{Root: t.TempDir(), MaxAPKBytes: 1024, GitHubClientID: "client-123", GitHubTokenConfigured: true})
	if err != nil {
		t.Fatal(err)
	}
	status := service.GitHubAuthStatus()
	if !status.Connected || status.Source != "environment" || status.CanDisconnect {
		t.Fatalf("environment status: %#v", status)
	}
	if err := service.DisconnectGitHub(); !errors.Is(err, ErrGitHubAuthManaged) {
		t.Fatalf("disconnect error = %v", err)
	}
}

func TestGitHubClientIDValidation(t *testing.T) {
	if _, err := NewService(nil, &authTestProvider{}, Config{Root: t.TempDir(), MaxAPKBytes: 1024, GitHubClientID: "bad client id"}); err == nil {
		t.Fatal("invalid GitHub client ID accepted")
	}
}
