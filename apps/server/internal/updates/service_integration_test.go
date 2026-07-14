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

func TestGitHubReleaseCheckStoresJSONDocuments(t *testing.T) {
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
		VersionName:              "0.11.0",
		Channel:                  "stable",
		MinimumSDK:               SupportedMinSDK,
		APKAssetName:             "tilecast-player.apk",
		APKSizeBytes:             1024,
		APKSHA256:                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		SigningCertificateSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		ReleaseNotes:             "Integration release",
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, rawManifest)))
	provider := &integrationProvider{
		result: ProviderResult{
			ETag: `"release-etag"`,
			Releases: []ProviderRelease{{
				ID:          110,
				Tag:         "player-v0.11.0",
				PublishedAt: time.Now().UTC(),
				Assets: []Asset{
					{Name: "tilecast-player-update.json", URL: "manifest", Size: int64(len(rawManifest))},
					{Name: "tilecast-player-update.json.sig", URL: "signature", Size: int64(len(signature))},
					{Name: "tilecast-player.apk", URL: "apk", Size: manifest.APKSizeBytes},
				},
			}},
		},
		downloads: map[string][]byte{"manifest": rawManifest, "signature": signature},
	}
	service, err := NewService(pool, provider, Config{
		Root:             t.TempDir(),
		TrustedPublicKey: base64.StdEncoding.EncodeToString(publicKey),
		MaxAPKBytes:      10 << 20,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = service.Check(ctx); err != nil {
		t.Fatalf("first release check: %v", err)
	}
	if err = service.Check(ctx); err != nil {
		t.Fatalf("second release check: %v", err)
	}

	var responseType, manifestType, storedVersion string
	if err = pool.QueryRow(ctx, `SELECT jsonb_typeof(response) FROM update_provider_state WHERE provider='github'`).Scan(&responseType); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT jsonb_typeof(manifest),manifest->>'versionName' FROM player_releases WHERE github_release_id=110`).Scan(&manifestType, &storedVersion); err != nil {
		t.Fatal(err)
	}
	if responseType != "array" || manifestType != "object" || storedVersion != manifest.VersionName {
		t.Fatalf("response=%q manifest=%q version=%q", responseType, manifestType, storedVersion)
	}
}

type integrationProvider struct {
	result    ProviderResult
	downloads map[string][]byte
}

func (p *integrationProvider) Releases(context.Context, string) (ProviderResult, error) {
	return p.result, nil
}

func (p *integrationProvider) Download(_ context.Context, rawURL string, _ int64) ([]byte, error) {
	value, ok := p.downloads[rawURL]
	if !ok {
		return nil, errors.New("asset not found")
	}
	return value, nil
}

func (p *integrationProvider) Open(context.Context, string) (*http.Response, error) {
	return nil, errors.New("not implemented")
}
