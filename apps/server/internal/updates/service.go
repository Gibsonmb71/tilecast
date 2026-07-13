package updates

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/avast/apkparser"
	"github.com/avast/apkverifier"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ApplicationID      = "org.tilecast.player"
	SupportedMinSDK    = 23
	CurrentVersionCode = 5
)

var digestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Manifest struct {
	SchemaVersion            int    `json:"schemaVersion"`
	Product                  string `json:"product"`
	ApplicationID            string `json:"applicationId"`
	VersionCode              int64  `json:"versionCode"`
	VersionName              string `json:"versionName"`
	Channel                  string `json:"channel"`
	MinimumSDK               int    `json:"minimumSdk"`
	APKAssetName             string `json:"apkAssetName"`
	APKSizeBytes             int64  `json:"apkSizeBytes"`
	APKSHA256                string `json:"apkSha256"`
	SigningCertificateSHA256 string `json:"signingCertificateSha256"`
	ReleaseNotes             string `json:"releaseNotes"`
}

type Config struct {
	Root             string
	TrustedPublicKey string
	MaxAPKBytes      int64
}

type Service struct {
	db       *pgxpool.Pool
	provider Provider
	root     string
	key      ed25519.PublicKey
	maxAPK   int64
}

type ImportedRelease struct {
	ID                 uuid.UUID
	Manifest           Manifest
	Source             string
	CacheStatus        string
	VerificationStatus string
	Duplicate          bool
}

func (s *Service) ManifestKeyConfigured() bool { return len(s.key) == ed25519.PublicKeySize }
func (s *Service) MaximumUploadBytes() int64   { return s.maxAPK + (256 << 10) }
func (s *Service) MaximumAPKBytes() int64      { return s.maxAPK }

func NewService(db *pgxpool.Pool, provider Provider, cfg Config) (*Service, error) {
	if err := os.MkdirAll(cfg.Root, 0o750); err != nil {
		return nil, fmt.Errorf("create update cache: %w", err)
	}
	var key ed25519.PublicKey
	if strings.TrimSpace(cfg.TrustedPublicKey) != "" {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cfg.TrustedPublicKey))
		if err != nil || len(decoded) != ed25519.PublicKeySize {
			return nil, errors.New("TILECAST_UPDATE_MANIFEST_PUBLIC_KEY must be a base64 Ed25519 public key")
		}
		key = ed25519.PublicKey(decoded)
	}
	return &Service{db: db, provider: provider, root: cfg.Root, key: key, maxAPK: cfg.MaxAPKBytes}, nil
}

func ParseAndVerifyManifest(raw, signature []byte, key ed25519.PublicKey) (Manifest, error) {
	if len(key) != ed25519.PublicKeySize {
		return Manifest{}, errors.New("trusted update manifest public key is not configured")
	}
	decodedSignature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signature)))
	if err != nil || !ed25519.Verify(key, raw, decodedSignature) {
		return Manifest{}, errors.New("invalid update manifest signature")
	}
	var manifest Manifest
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, errors.New("invalid update manifest")
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return Manifest{}, errors.New("update manifest must contain one JSON object")
	}
	if manifest.SchemaVersion != 1 || manifest.Product != "tilecast-player" || manifest.ApplicationID != ApplicationID || manifest.VersionCode <= CurrentVersionCode || manifest.VersionName == "" || manifest.APKAssetName != "tilecast-player.apk" || manifest.APKSizeBytes <= 0 || !digestPattern.MatchString(strings.ToLower(manifest.APKSHA256)) || !digestPattern.MatchString(strings.ToLower(manifest.SigningCertificateSHA256)) {
		return Manifest{}, errors.New("update manifest metadata is invalid or not newer than this Tilecast Player baseline")
	}
	if manifest.Channel != "stable" && manifest.Channel != "beta" {
		return Manifest{}, errors.New("update channel is invalid")
	}
	if manifest.MinimumSDK < SupportedMinSDK || manifest.MinimumSDK > 35 {
		return Manifest{}, errors.New("update minimum SDK is unsupported")
	}
	return manifest, nil
}

// ImportUpload verifies a locally uploaded release with the same manifest, APK,
// package, and signing-certificate checks used for GitHub releases. The caller
// owns apkPath and may remove it after this method returns.
func (s *Service) ImportUpload(ctx context.Context, apkPath string, raw, signature []byte, importedBy *uuid.UUID) (ImportedRelease, error) {
	manifest, err := ParseAndVerifyManifest(raw, signature, s.key)
	if err != nil {
		return ImportedRelease{}, err
	}
	if manifest.APKSizeBytes > s.maxAPK {
		return ImportedRelease{}, errors.New("APK exceeds the configured player update size limit")
	}
	info, err := os.Stat(apkPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() != manifest.APKSizeBytes {
		return ImportedRelease{}, errors.New("APK size does not match the signed manifest")
	}

	id := uuid.New()
	part := filepath.Join(s.root, id.String()+".apk.part")
	final := filepath.Join(s.root, id.String()+".apk")
	input, err := os.Open(apkPath)
	if err != nil {
		return ImportedRelease{}, errors.New("uploaded APK could not be read")
	}
	output, err := os.OpenFile(part, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o640)
	if err != nil {
		input.Close()
		return ImportedRelease{}, err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, s.maxAPK+1))
	inputErr := input.Close()
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil || inputErr != nil || syncErr != nil || closeErr != nil || written != manifest.APKSizeBytes || hex.EncodeToString(hash.Sum(nil)) != strings.ToLower(manifest.APKSHA256) {
		_ = os.Remove(part)
		return ImportedRelease{}, errors.New("APK size or SHA-256 verification failed")
	}
	if err := verifyAPK(part, manifest); err != nil {
		_ = os.Remove(part)
		return ImportedRelease{}, err
	}

	var existingID uuid.UUID
	var existingHash, existingCert, existingVerification, existingCache, existingSource string
	err = s.db.QueryRow(ctx, `SELECT id,apk_sha256,signing_certificate_sha256,verification_status,cache_status,source FROM player_releases WHERE version_code=$1`, manifest.VersionCode).Scan(&existingID, &existingHash, &existingCert, &existingVerification, &existingCache, &existingSource)
	if err == nil {
		_ = os.Remove(part)
		if existingHash == strings.ToLower(manifest.APKSHA256) && existingCert == strings.ToLower(manifest.SigningCertificateSHA256) && existingVerification == "verified" && existingCache == "cached" {
			return ImportedRelease{ID: existingID, Manifest: manifest, Source: existingSource, CacheStatus: existingCache, VerificationStatus: existingVerification, Duplicate: true}, nil
		}
		return ImportedRelease{}, errors.New("this version code already exists with different or invalid release data")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		_ = os.Remove(part)
		return ImportedRelease{}, err
	}
	var latestVersion int64
	if err := s.db.QueryRow(ctx, `SELECT COALESCE(max(version_code),$1) FROM player_releases`, CurrentVersionCode).Scan(&latestVersion); err != nil {
		_ = os.Remove(part)
		return ImportedRelease{}, err
	}
	if manifest.VersionCode <= latestVersion {
		_ = os.Remove(part)
		return ImportedRelease{}, errors.New("player release version code must be newer than every imported release")
	}
	if err := os.Rename(part, final); err != nil {
		_ = os.Remove(part)
		return ImportedRelease{}, err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO player_releases(id,channel,version_code,version_name,application_id,minimum_sdk,release_notes,published_at,apk_name,apk_size,apk_sha256,signing_certificate_sha256,manifest,manifest_signature,cache_status,verification_status,source,imported_by) VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,$10,$11,$12,$13,'cached','verified','upload',$14)`, id, manifest.Channel, manifest.VersionCode, manifest.VersionName, manifest.ApplicationID, manifest.MinimumSDK, manifest.ReleaseNotes, manifest.APKAssetName, manifest.APKSizeBytes, strings.ToLower(manifest.APKSHA256), strings.ToLower(manifest.SigningCertificateSHA256), raw, strings.TrimSpace(string(signature)), importedBy)
	if err != nil {
		_ = os.Remove(final)
		return ImportedRelease{}, err
	}
	return ImportedRelease{ID: id, Manifest: manifest, Source: "upload", CacheStatus: "cached", VerificationStatus: "verified"}, nil
}

func (s *Service) Check(ctx context.Context) error {
	var etag string
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(etag,'') FROM update_provider_state WHERE provider='github'`).Scan(&etag)
	result, err := s.provider.Releases(ctx, etag)
	if err != nil {
		_, _ = s.db.Exec(ctx, `INSERT INTO update_provider_state(provider,last_checked_at,safe_error,updated_at)VALUES('github',now(),$1,now()) ON CONFLICT(provider) DO UPDATE SET last_checked_at=now(),safe_error=$1,updated_at=now()`, safeError(err))
		return err
	}
	if result.NotModified {
		_, _ = s.db.Exec(ctx, `UPDATE update_provider_state SET last_checked_at=now(),safe_error=NULL,updated_at=now() WHERE provider='github'`)
		return nil
	}
	encoded, _ := json.Marshal(result.Releases)
	_, _ = s.db.Exec(ctx, `INSERT INTO update_provider_state(provider,etag,last_checked_at,rate_limit_reset_at,response,safe_error,updated_at)VALUES('github',$1,now(),$2,$3,NULL,now()) ON CONFLICT(provider) DO UPDATE SET etag=$1,last_checked_at=now(),rate_limit_reset_at=$2,response=$3,safe_error=NULL,updated_at=now()`, result.ETag, result.RateReset, encoded)
	var imported int
	var firstImportError error
	for _, release := range result.Releases {
		if importErr := s.importRelease(ctx, release); importErr != nil {
			if firstImportError == nil {
				firstImportError = importErr
			}
		} else {
			imported++
		}
	}
	if imported == 0 && firstImportError != nil {
		_, _ = s.db.Exec(ctx, `UPDATE update_provider_state SET safe_error=$1,updated_at=now() WHERE provider='github'`, safeError(firstImportError))
		return firstImportError
	}
	return nil
}

func (s *Service) importRelease(ctx context.Context, release ProviderRelease) error {
	assets := map[string]Asset{}
	for _, asset := range release.Assets {
		assets[asset.Name] = asset
	}
	manifestAsset, manifestOK := assets["tilecast-player-update.json"]
	signatureAsset, signatureOK := assets["tilecast-player-update.json.sig"]
	apkAsset, apkOK := assets["tilecast-player.apk"]
	if !manifestOK || !signatureOK || !apkOK {
		return errors.New("release is missing required Tilecast Player assets")
	}
	raw, err := s.provider.Download(ctx, manifestAsset.URL, 128<<10)
	if err != nil {
		return err
	}
	signature, err := s.provider.Download(ctx, signatureAsset.URL, 4<<10)
	if err != nil {
		return err
	}
	manifest, err := ParseAndVerifyManifest(raw, signature, s.key)
	if err != nil {
		return err
	}
	expectedChannel := "stable"
	if release.Prerelease {
		expectedChannel = "beta"
	}
	if manifest.Channel != expectedChannel || manifest.APKSizeBytes != apkAsset.Size || manifest.APKSizeBytes > s.maxAPK {
		return errors.New("GitHub asset metadata does not match the signed update manifest")
	}
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte(fmt.Sprintf("github:%d", release.ID)))
	_, err = s.db.Exec(ctx, `INSERT INTO player_releases(id,github_release_id,github_tag,channel,version_code,version_name,application_id,minimum_sdk,release_notes,published_at,apk_name,apk_size,apk_sha256,signing_certificate_sha256,manifest,manifest_signature,apk_download_url,verification_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'verified_manifest') ON CONFLICT(github_release_id) DO UPDATE SET manifest=EXCLUDED.manifest,manifest_signature=EXCLUDED.manifest_signature,updated_at=now()`, id, release.ID, release.Tag, manifest.Channel, manifest.VersionCode, manifest.VersionName, manifest.ApplicationID, manifest.MinimumSDK, manifest.ReleaseNotes, release.PublishedAt, manifest.APKAssetName, manifest.APKSizeBytes, strings.ToLower(manifest.APKSHA256), strings.ToLower(manifest.SigningCertificateSHA256), raw, strings.TrimSpace(string(signature)), apkAsset.URL)
	return err
}

func (s *Service) Cache(ctx context.Context, releaseID uuid.UUID) error {
	var assetURL, expectedHash, expectedCert string
	var expectedSize int64
	if err := s.db.QueryRow(ctx, `SELECT apk_download_url,apk_size,apk_sha256,signing_certificate_sha256 FROM player_releases WHERE id=$1 AND verification_status<>'failed'`, releaseID).Scan(&assetURL, &expectedSize, &expectedHash, &expectedCert); err != nil {
		return errors.New("verified player release was not found")
	}
	response, err := s.provider.Open(ctx, assetURL)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.ContentLength > s.maxAPK {
		return errors.New("GitHub APK download was rejected")
	}
	part := filepath.Join(s.root, releaseID.String()+".apk.part")
	final := filepath.Join(s.root, releaseID.String()+".apk")
	file, err := os.OpenFile(part, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, s.maxAPK+1))
	syncErr := file.Sync()
	closeErr := file.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || written != expectedSize || hex.EncodeToString(hash.Sum(nil)) != expectedHash {
		_ = os.Remove(part)
		return errors.New("APK size or SHA-256 verification failed")
	}
	var expectedApplication string
	var expectedVersion int64
	var expectedMinSDK int
	_ = s.db.QueryRow(ctx, `SELECT application_id,version_code,minimum_sdk FROM player_releases WHERE id=$1`, releaseID).Scan(&expectedApplication, &expectedVersion, &expectedMinSDK)
	if err := verifyAPK(part, Manifest{ApplicationID: expectedApplication, VersionCode: expectedVersion, MinimumSDK: expectedMinSDK, SigningCertificateSHA256: expectedCert}); err != nil {
		_ = os.Remove(part)
		return err
	}
	if err := os.Rename(part, final); err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE player_releases SET cache_status='cached',verification_status='verified',verification_error=NULL,updated_at=now() WHERE id=$1`, releaseID)
	return err
}

func verifyAPK(path string, manifest Manifest) error {
	verification, err := apkverifier.Verify(path, nil)
	if err != nil {
		return errors.New("APK signing verification failed")
	}
	cert, _ := apkverifier.PickBestApkCert(verification.SignerCerts)
	if cert == nil || strings.ToLower(strings.ReplaceAll(cert.Sha256, ":", "")) != strings.ToLower(manifest.SigningCertificateSHA256) {
		return errors.New("APK signing certificate does not match the signed manifest")
	}
	application, version, minimumSDK, metadataErr := apkMetadata(path)
	if metadataErr != nil || application != manifest.ApplicationID || version != manifest.VersionCode || minimumSDK != manifest.MinimumSDK {
		return errors.New("APK package metadata does not match the signed manifest")
	}
	return nil
}

func apkMetadata(path string) (string, int64, int, error) {
	var output bytes.Buffer
	zipErr, _, manifestErr := apkparser.ParseApk(path, xml.NewEncoder(&output))
	if zipErr != nil || manifestErr != nil {
		return "", 0, 0, errors.New("APK manifest could not be parsed")
	}
	decoder := xml.NewDecoder(bytes.NewReader(output.Bytes()))
	var application string
	var version int64
	var minimumSDK int
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", 0, 0, err
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		for _, attribute := range start.Attr {
			if start.Name.Local == "manifest" && attribute.Name.Local == "package" {
				application = attribute.Value
			}
			if start.Name.Local == "manifest" && attribute.Name.Local == "versionCode" {
				version, _ = strconv.ParseInt(attribute.Value, 10, 64)
			}
			if start.Name.Local == "uses-sdk" && attribute.Name.Local == "minSdkVersion" {
				minimumSDK, _ = strconv.Atoi(attribute.Value)
			}
		}
	}
	if application == "" || version <= 0 || minimumSDK <= 0 {
		return "", 0, 0, errors.New("APK manifest metadata is incomplete")
	}
	return application, version, minimumSDK, nil
}

func (s *Service) APKPath(ctx context.Context, releaseID uuid.UUID) (string, int64, string, error) {
	var size int64
	var hash, status string
	if err := s.db.QueryRow(ctx, `SELECT apk_size,apk_sha256,verification_status FROM player_releases WHERE id=$1`, releaseID).Scan(&size, &hash, &status); err != nil || status != "verified" {
		return "", 0, "", errors.New("verified cached release was not found")
	}
	return filepath.Join(s.root, releaseID.String()+".apk"), size, hash, nil
}

func (s *Service) Cleanup(ctx context.Context, retentionDays int) {
	rows, err := s.db.Query(ctx, `DELETE FROM player_releases pr WHERE pr.updated_at<now()-make_interval(days=>$1) AND NOT EXISTS(SELECT 1 FROM update_deployments d WHERE d.release_id=pr.id) RETURNING id`, retentionDays)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if rows.Scan(&id) == nil {
			_ = os.Remove(filepath.Join(s.root, id.String()+".apk"))
			_ = os.Remove(filepath.Join(s.root, id.String()+".apk.part"))
		}
	}
}

func safeError(err error) string {
	message := err.Error()
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}
