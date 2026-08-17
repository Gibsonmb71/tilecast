package updates

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func TestGitHubReleaseCheckRetriesFailedImportWithoutETag(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer lockPool.Close()
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	if _, err = lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	defer lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) //nolint:errcheck
	if err = database.Migrate(ctx, databaseURL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, `TRUNCATE update_provider_state,player_releases CASCADE`); err != nil {
		t.Fatal(err)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{
		SchemaVersion:            1,
		Product:                  "tilecast-player",
		ApplicationID:            ApplicationID,
		VersionCode:              CurrentVersionCode + 1,
		VersionName:              "0.11.1",
		Channel:                  "stable",
		MinimumSDK:               SupportedMinSDK,
		APKAssetName:             AndroidArtifactName,
		APKSizeBytes:             1024,
		APKSHA256:                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		ReleaseNotes:             "Retry integration release",
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, rawManifest)))
	provider := &retryIntegrationProvider{
		result: ProviderResult{
			ETag: `"retry-etag"`,
			Releases: []ProviderRelease{{
				ID:          111,
				Tag:         "player-v0.11.1",
				PublishedAt: time.Now().UTC(),
				Assets: []Asset{
					{Name: "tilecast-player-update.json", URL: "manifest", Size: int64(len(rawManifest))},
					{Name: "tilecast-player-update.json.sig", URL: "signature", Size: int64(len(signature))},
					{Name: AndroidArtifactName, URL: "apk", Size: manifest.APKSizeBytes},
				},
			}},
		},
		downloads:     map[string][]byte{"manifest": rawManifest, "signature": signature},
		failDownloads: 1,
	}
	service, err := NewService(pool, provider, Config{
		Root:             t.TempDir(),
		TrustedPublicKey: base64.StdEncoding.EncodeToString(publicKey),
		MaxAPKBytes:      10 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err = service.Check(ctx); err == nil {
		t.Fatal("first release check unexpectedly succeeded")
	}
	var storedETag string
	var hasSafeError bool
	if err = pool.QueryRow(ctx, `SELECT COALESCE(etag,''),safe_error IS NOT NULL FROM update_provider_state WHERE provider='github'`).Scan(&storedETag, &hasSafeError); err != nil {
		t.Fatal(err)
	}
	if storedETag != `"retry-etag"` || !hasSafeError {
		t.Fatalf("failed check stored etag=%q safe_error=%t", storedETag, hasSafeError)
	}

	if err = service.Check(ctx); err != nil {
		t.Fatalf("retry release check: %v", err)
	}
	if len(provider.etags) != 2 || provider.etags[0] != "" || provider.etags[1] != "" {
		t.Fatalf("release request etags = %#v, want two unconditional requests", provider.etags)
	}
	var storedVersion string
	if err = pool.QueryRow(ctx, `SELECT version_name FROM player_releases WHERE github_release_id=111`).Scan(&storedVersion); err != nil {
		t.Fatal(err)
	}
	if storedVersion != manifest.VersionName {
		t.Fatalf("stored version = %q, want %q", storedVersion, manifest.VersionName)
	}
}

type retryIntegrationProvider struct {
	result        ProviderResult
	downloads     map[string][]byte
	failDownloads int
	etags         []string
}

func (p *retryIntegrationProvider) Releases(_ context.Context, etag string) (ProviderResult, error) {
	p.etags = append(p.etags, etag)
	if etag != "" {
		return ProviderResult{NotModified: true}, nil
	}
	return p.result, nil
}

func (p *retryIntegrationProvider) Download(_ context.Context, rawURL string, _ int64) ([]byte, error) {
	if p.failDownloads > 0 {
		p.failDownloads--
		return nil, errors.New("temporary asset download failure")
	}
	value, ok := p.downloads[rawURL]
	if !ok {
		return nil, errors.New("asset not found")
	}
	return value, nil
}

func (p *retryIntegrationProvider) Open(context.Context, string) (*http.Response, error) {
	return nil, errors.New("unexpected artifact request")
}
