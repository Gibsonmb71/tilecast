package updates

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
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

func TestLinuxGitHubReleaseSyncAndCache(t *testing.T) {
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
	artifact := []byte("production-shaped AppImage bytes")
	digest := sha256.Sum256(artifact)
	manifest := Manifest{
		SchemaVersion:     1,
		Product:           "tilecast-player",
		Platform:          PlatformLinux,
		VersionCode:       2004,
		VersionName:       "0.2.4",
		Channel:           "stable",
		ArtifactAssetName: LinuxArtifactName,
		ArtifactSizeBytes: int64(len(artifact)),
		ArtifactSHA256:    hex.EncodeToString(digest[:]),
		ReleaseNotes:      "Linux Studio update integration release",
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	signature := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, rawManifest)))
	provider := &integrationProvider{
		result: ProviderResult{
			ETag: `"linux-release-etag"`,
			Releases: []ProviderRelease{{
				ID:          204,
				Tag:         "player-linux-v0.2.4",
				PublishedAt: time.Now().UTC(),
				Assets: []Asset{
					{Name: "tilecast-player-update-linux.json", URL: "linux-manifest", Size: int64(len(rawManifest))},
					{Name: "tilecast-player-update-linux.json.sig", URL: "linux-signature", Size: int64(len(signature))},
					{Name: LinuxArtifactName, URL: "linux-appimage", Size: int64(len(artifact))},
				},
			}},
		},
		downloads: map[string][]byte{
			"linux-manifest":  rawManifest,
			"linux-signature": signature,
		},
		artifacts: map[string][]byte{"linux-appimage": artifact},
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
		t.Fatalf("sync Linux release: %v", err)
	}

	var releaseID uuid.UUID
	var platform, versionName, cacheStatus, verificationStatus, artifactURL string
	var versionCode int64
	if err = pool.QueryRow(ctx, `SELECT id,platform,version_code,version_name,cache_status,verification_status,apk_download_url FROM player_releases WHERE github_release_id=204`).Scan(&releaseID, &platform, &versionCode, &versionName, &cacheStatus, &verificationStatus, &artifactURL); err != nil {
		t.Fatal(err)
	}
	if platform != PlatformLinux || versionCode != 2004 || versionName != "0.2.4" || cacheStatus != "missing" || verificationStatus != "verified_manifest" || artifactURL != "linux-appimage" {
		t.Fatalf("unexpected synchronized release: platform=%q code=%d name=%q cache=%q verification=%q url=%q", platform, versionCode, versionName, cacheStatus, verificationStatus, artifactURL)
	}

	if err = service.Cache(ctx, releaseID); err != nil {
		t.Fatalf("cache Linux release: %v", err)
	}
	path, size, hash, cachedPlatform, err := service.ArtifactPath(ctx, releaseID)
	if err != nil {
		t.Fatal(err)
	}
	cached, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(cached, artifact) || size != int64(len(artifact)) || hash != manifest.ArtifactSHA256 || cachedPlatform != PlatformLinux {
		t.Fatalf("cached artifact mismatch: bytes=%q size=%d hash=%q platform=%q", cached, size, hash, cachedPlatform)
	}
}

type integrationProvider struct {
	result    ProviderResult
	downloads map[string][]byte
	artifacts map[string][]byte
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

func (p *integrationProvider) Open(_ context.Context, rawURL string) (*http.Response, error) {
	value, ok := p.artifacts[rawURL]
	if !ok {
		return nil, errors.New("asset not found")
	}
	return &http.Response{
		StatusCode:    http.StatusOK,
		ContentLength: int64(len(value)),
		Body:          io.NopCloser(bytes.NewReader(value)),
	}, nil
}
