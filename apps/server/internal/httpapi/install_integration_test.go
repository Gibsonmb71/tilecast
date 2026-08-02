package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/updates"
)

// cacheLinuxRelease writes the release row and on-disk artifact that caching a
// Linux release in Studio produces.
func cacheLinuxRelease(t *testing.T, env activityTestEnvironment, root string, body []byte) string {
	t.Helper()
	digest := sha256.Sum256(body)
	hash := hex.EncodeToString(digest[:])
	id := uuid.New()
	if _, err := env.pool.Exec(context.Background(), `INSERT INTO player_releases(id,github_release_id,github_tag,channel,version_code,version_name,application_id,minimum_sdk,published_at,apk_name,apk_size,apk_sha256,signing_certificate_sha256,manifest,manifest_signature,apk_download_url,cache_status,verification_status,platform)
		VALUES($1,$2,$3,'stable',12000,'0.12.0',NULL,NULL,now(),'tilecast-player.AppImage',$4,$5,'','{}'::jsonb,'','https://example.invalid/artifact','cached','verified','linux')`,
		id, int64(4210), "player-linux-v0.12.0", int64(len(body)), hash); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, id.String()+".AppImage"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestInstallScriptCarriesTheServerAddress(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		env.server.publicURL = "https://signage.example.org/"
		recorder := httptest.NewRecorder()
		env.server.installScript(recorder, httptest.NewRequest(http.MethodGet, "/install.sh", nil))

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d", recorder.Code)
		}
		body := recorder.Body.String()
		if strings.Contains(body, installServerURLToken) {
			t.Fatal("the server address placeholder was not substituted")
		}
		if !strings.Contains(body, `readonly SERVER_URL="https://signage.example.org"`) {
			t.Fatalf("script does not carry the public URL: %s", firstLines(body, 30))
		}
		// A box that can reach only this server must not be sent elsewhere.
		if strings.Contains(body, "github.com") || strings.Contains(body, "githubusercontent") {
			t.Fatal("the installer reaches GitHub; it must fetch everything from the server")
		}
	})
}

func TestInstallScriptFallsBackToTheRequestHost(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		env.server.publicURL = ""
		request := httptest.NewRequest(http.MethodGet, "/install.sh", nil)
		request.Host = "tilecast.internal"
		request.Header.Set("X-Forwarded-Proto", "https")
		recorder := httptest.NewRecorder()
		env.server.installScript(recorder, request)

		if !strings.Contains(recorder.Body.String(), `readonly SERVER_URL="https://tilecast.internal"`) {
			t.Fatalf("script does not carry the forwarded host: %s", firstLines(recorder.Body.String(), 30))
		}
	})
}

func TestServedPlayerUnitIncludesManagedHostToolPath(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		recorder := httptest.NewRecorder()
		env.server.playerServiceUnit(
			recorder,
			httptest.NewRequest(http.MethodGet, "/install/tilecast-player.service", nil),
		)
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d", recorder.Code)
		}
		if !strings.Contains(
			recorder.Body.String(),
			"Environment=PATH=/usr/local/bin:/usr/bin:/bin",
		) {
			t.Fatal("served player unit does not define the managed host-tool PATH")
		}
	})
}

func TestInstallableLinuxReleaseReportsNothingUntilOneIsCached(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		env.server.updates = newTestUpdateService(t, env, t.TempDir())
		recorder := httptest.NewRecorder()
		env.server.installableLinuxRelease(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/install/linux", nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("status = %d, want 404 before a release is cached", recorder.Code)
		}
	})
}

func TestInstallableLinuxReleaseServesTheCachedArtifact(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		root := t.TempDir()
		env.server.updates = newTestUpdateService(t, env, root)
		body := []byte("AppImage payload")
		hash := cacheLinuxRelease(t, env, root, body)

		recorder := httptest.NewRecorder()
		env.server.installableLinuxRelease(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/install/linux", nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		var payload struct {
			Data struct {
				VersionName string `json:"versionName"`
				SizeBytes   int64  `json:"sizeBytes"`
				SHA256      string `json:"sha256"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Data.VersionName != "0.12.0" || payload.Data.SHA256 != hash || payload.Data.SizeBytes != int64(len(body)) {
			t.Fatalf("release metadata = %#v", payload.Data)
		}

		// The checksum the script verifies has to match the bytes it receives,
		// or every install fails on a mismatch it cannot diagnose.
		artifact := httptest.NewRecorder()
		env.server.installableLinuxArtifact(artifact, httptest.NewRequest(http.MethodGet, "/api/v1/install/linux/artifact", nil))
		if artifact.Code != http.StatusOK {
			t.Fatalf("artifact status = %d", artifact.Code)
		}
		served := sha256.Sum256(artifact.Body.Bytes())
		if hex.EncodeToString(served[:]) != hash {
			t.Fatal("served artifact does not match the advertised checksum")
		}
	})
}

// A beta or unverified release must not be handed to a new machine.
func TestInstallableLinuxReleaseIgnoresBetaAndUnverifiedReleases(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		root := t.TempDir()
		env.server.updates = newTestUpdateService(t, env, root)
		cacheLinuxRelease(t, env, root, []byte("AppImage payload"))
		if _, err := env.pool.Exec(context.Background(), `UPDATE player_releases SET channel='beta'`); err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		env.server.installableLinuxRelease(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/install/linux", nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("beta release status = %d, want 404", recorder.Code)
		}

		if _, err := env.pool.Exec(context.Background(), `UPDATE player_releases SET channel='stable',verification_status='verified_manifest'`); err != nil {
			t.Fatal(err)
		}
		recorder = httptest.NewRecorder()
		env.server.installableLinuxRelease(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/install/linux", nil))
		if recorder.Code != http.StatusNotFound {
			t.Fatalf("unverified release status = %d, want 404", recorder.Code)
		}
	})
}

func newTestUpdateService(t *testing.T, env activityTestEnvironment, root string) *updates.Service {
	t.Helper()
	service, err := updates.NewService(env.pool, nil, updates.Config{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func firstLines(body string, count int) string {
	lines := strings.SplitN(body, "\n", count+1)
	if len(lines) > count {
		lines = lines[:count]
	}
	return strings.Join(lines, "\n")
}

// Every URL the served script fetches has to be a route this server answers. A
// typo here is invisible until a provisioning run fails on a real machine, so
// the paths are extracted from the script itself rather than restated.
func TestInstallScriptOnlyFetchesRoutesTheServerServes(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		root := t.TempDir()
		env.server.updates = newTestUpdateService(t, env, root)
		cacheLinuxRelease(t, env, root, []byte("AppImage payload"))

		// The shared harness builds a server value directly, so the limiters
		// New() would have created are nil. Provisioning routes go through one.
		env.server.installLimiter = newRateLimiter(60, time.Minute)
		origin := httptest.NewServer(env.server.routes())
		defer origin.Close()
		env.server.publicURL = origin.URL

		script := httptest.NewRecorder()
		env.server.installScript(script, httptest.NewRequest(http.MethodGet, "/install.sh", nil))
		paths := scriptFetchPaths(script.Body.String())
		if len(paths) < 4 {
			t.Fatalf("expected the installer to fetch several server paths, found %v", paths)
		}

		for _, path := range paths {
			response, err := origin.Client().Get(origin.URL + path)
			if err != nil {
				t.Fatalf("GET %s: %v", path, err)
			}
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode != http.StatusOK {
				t.Fatalf("GET %s = %d, body = %s", path, response.StatusCode, string(body))
			}
			if len(body) == 0 {
				t.Fatalf("GET %s served an empty body", path)
			}
		}
	})
}

// scriptFetchPaths pulls the "${SERVER_URL}/..." targets out of the script.
func scriptFetchPaths(script string) []string {
	seen := map[string]bool{}
	paths := []string{}
	for _, match := range regexp.MustCompile(`\$\{SERVER_URL\}(/[A-Za-z0-9._/-]+)`).FindAllStringSubmatch(script, -1) {
		path := match[1]
		// /screens is the Studio link printed in the summary, not a fetch.
		if seen[path] || path == "/screens" {
			continue
		}
		seen[path] = true
		paths = append(paths, path)
	}
	return paths
}
