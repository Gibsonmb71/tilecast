package updates

import (
	"errors"
	"os"
	"testing"
)

func TestGitHubClientIDCanBeConfiguredAndReloaded(t *testing.T) {
	root := t.TempDir()
	service, err := NewService(nil, &authTestProvider{}, Config{Root: root, MaxAPKBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if status := service.GitHubAuthStatus(); status.Available {
		t.Fatalf("unexpected initial status: %#v", status)
	}
	if err := service.ConfigureGitHubClientID("client-from-studio"); err != nil {
		t.Fatal(err)
	}
	if status := service.GitHubAuthStatus(); !status.Available || status.Connected {
		t.Fatalf("configured status: %#v", status)
	}
	info, err := os.Stat(service.github.clientIDPath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("configuration mode=%v", info.Mode().Perm())
	}

	restarted, err := NewService(nil, &authTestProvider{}, Config{Root: root, MaxAPKBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if status := restarted.GitHubAuthStatus(); !status.Available || status.Connected {
		t.Fatalf("restarted status: %#v", status)
	}
	if _, err := restarted.BeginGitHubDeviceAuthorization(t.Context()); err != nil {
		t.Fatal(err)
	}
}

func TestEnvironmentGitHubClientIDCannotBeReplaced(t *testing.T) {
	service, err := NewService(nil, &authTestProvider{}, Config{Root: t.TempDir(), MaxAPKBytes: 1024, GitHubClientID: "environment-client"})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ConfigureGitHubClientID("studio-client"); !errors.Is(err, ErrGitHubClientIDManaged) {
		t.Fatalf("configure error=%v", err)
	}
}

func TestConfiguredGitHubClientIDValidation(t *testing.T) {
	service, err := NewService(nil, &authTestProvider{}, Config{Root: t.TempDir(), MaxAPKBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ConfigureGitHubClientID("bad client id"); !errors.Is(err, ErrGitHubClientIDInvalid) {
		t.Fatalf("configure error=%v", err)
	}
}
