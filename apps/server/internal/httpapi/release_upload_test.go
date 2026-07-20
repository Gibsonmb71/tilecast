package httpapi

import (
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReleaseUploadPartValidation(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		accepted    bool
		limit       int64
	}{
		{"tilecast-player.apk", "application/vnd.android.package-archive", true, 512 << 20},
		{"tilecast-player.apk", "application/octet-stream", true, 512 << 20},
		{"tilecast-player-update.json", "application/json; charset=utf-8", true, 128 << 10},
		{"tilecast-player-update.json.sig", "text/plain", true, 4 << 10},
		{"tilecast-player.AppImage", "application/octet-stream", true, 512 << 20},
		{"tilecast-player.AppImage", "application/x-executable", true, 512 << 20},
		{"tilecast-player-update-linux.json", "application/json", true, 128 << 10},
		{"tilecast-player-update-linux.json.sig", "application/octet-stream", true, 4 << 10},
		{"tilecast-player.AppImage", "text/html", false, 512 << 20},
		{"player.apk", "application/vnd.android.package-archive", false, 0},
		{"tilecast-player.apk", "text/html", false, 512 << 20},
	}
	for _, test := range tests {
		limit, accepted := releaseUploadPartLimit(test.name, test.contentType, 512<<20)
		if accepted != test.accepted || limit != test.limit {
			t.Fatalf("%s (%s): accepted=%v limit=%d", test.name, test.contentType, accepted, limit)
		}
	}
}

func TestReleasePublisherToken(t *testing.T) {
	token := "a-high-entropy-ci-publishing-token"
	s := &server{releasePublishTokenHash: sha256.Sum256([]byte(token)), releasePublishTokenConfigured: true}
	called := false
	handler := s.requireReleasePublisher(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/player-releases/upload", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !called {
		t.Fatalf("valid publisher token was rejected: status=%d", response.Code)
	}

	called = false
	request = httptest.NewRequest(http.MethodPost, "/api/v1/player-releases/upload", nil)
	request.Header.Set("Authorization", "Bearer wrong-token")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || called {
		t.Fatalf("invalid publisher token was accepted: status=%d", response.Code)
	}
}
