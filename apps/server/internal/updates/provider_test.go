package updates

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFixedGitHubReleaseSource(t *testing.T) {
	provider := NewGitHubProvider("")
	if _, err := provider.Open(t.Context(), "https://example.com/tilecast-player.apk"); err == nil {
		t.Fatal("arbitrary update URL accepted")
	}
	if GitHubOwner != "gbyo" || GitHubRepo != "tilecast" {
		t.Fatal("GitHub source is not fixed")
	}
}

func TestGitHubDeviceAuthorizationProtocol(t *testing.T) {
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/login/device/code":
			if err := r.ParseForm(); err != nil || r.Form.Get("client_id") != "client-123" {
				t.Fatalf("unexpected device form: %v %#v", err, r.Form)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"device_code": "secret-device-code", "user_code": "ABCD-EFGH", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 1})
		case "/login/oauth/access_token":
			if err := r.ParseForm(); err != nil || r.Form.Get("client_id") != "client-123" || r.Form.Get("device_code") != "secret-device-code" || r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:device_code" {
				t.Fatalf("unexpected token form: %v %#v", err, r.Form)
			}
			polls++
			if polls == 1 {
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "authorization_pending"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "github-access-token", "token_type": "bearer"})
		case "/user":
			if r.Header.Get("Authorization") != "Bearer github-access-token" {
				t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"login": "tilecast-owner"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := NewGitHubProvider("")
	provider.client = server.Client()
	provider.oauthBase = server.URL
	provider.apiBase = server.URL
	device, err := provider.BeginDeviceAuthorization(t.Context(), "client-123")
	if err != nil {
		t.Fatal(err)
	}
	if device.UserCode != "ABCD-EFGH" || device.Interval.Seconds() != 5 {
		t.Fatalf("unexpected device authorization: %#v", device)
	}
	first, err := provider.PollDeviceAuthorization(t.Context(), "client-123", device.DeviceCode)
	if err != nil || first.Status != "pending" {
		t.Fatalf("pending poll: result=%#v err=%v", first, err)
	}
	second, err := provider.PollDeviceAuthorization(t.Context(), "client-123", device.DeviceCode)
	if err != nil || second.AccessToken == "" {
		t.Fatalf("completed poll: result=%#v err=%v", second, err)
	}
	login, err := provider.Viewer(t.Context(), second.AccessToken)
	if err != nil || login != "tilecast-owner" {
		t.Fatalf("viewer=%q err=%v", login, err)
	}
}

func TestGitHubDeviceAuthorizationRejectsUntrustedVerificationURI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"device_code": "secret", "user_code": "ABCD-EFGH", "verification_uri": "https://example.com/device", "expires_in": 900, "interval": 5})
	}))
	defer server.Close()
	provider := NewGitHubProvider("")
	provider.client = server.Client()
	provider.oauthBase = server.URL
	if _, err := provider.BeginDeviceAuthorization(t.Context(), "client-123"); err == nil {
		t.Fatal("untrusted verification URI accepted")
	}
}

func TestGitHubProviderUsesUpdatedToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/releases") || r.Header.Get("Authorization") != "Bearer new-token" {
			t.Fatalf("request path=%q authorization=%q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode([]ProviderRelease{})
	}))
	defer server.Close()
	provider := NewGitHubProvider("old-token")
	provider.client = server.Client()
	provider.apiBase = server.URL
	provider.SetToken("new-token")
	if _, err := provider.Releases(t.Context(), ""); err != nil {
		t.Fatal(err)
	}
}
