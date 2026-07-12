package updates

import "testing"

func TestFixedGitHubReleaseSource(t *testing.T) {
	provider := NewGitHubProvider("")
	if _, err := provider.Open(t.Context(), "https://example.com/tilecast-player.apk"); err == nil {
		t.Fatal("arbitrary update URL accepted")
	}
	if GitHubOwner != "Gibsonmb71" || GitHubRepo != "tilecast" {
		t.Fatal("GitHub source is not fixed")
	}
}
