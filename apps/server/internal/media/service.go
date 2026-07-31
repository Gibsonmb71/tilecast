package media

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
)

const UploadLifetime = 24 * time.Hour

type Config struct {
	MaxUploadBytes          int64
	ReservedFreeBytes       uint64
	FFmpegPath, FFprobePath string
	Profile                 CompatibilityProfile
	Workers                 int
	KeepOriginals           bool
	Website                 WebsitePolicy
	SourceFetch             SourceFetchPolicy
	AirQualityBaseURL       string
}
type Service struct {
	db          *pgxpool.Pool
	storage     Storage
	cfg         Config
	invalidator AssetInvalidator
	definitions *contentdefs.Catalog
}

func NewService(db *pgxpool.Pool, storage Storage, cfg Config) *Service {
	return &Service{db: db, storage: storage, cfg: cfg, definitions: contentdefs.MustLoad()}
}
func (s *Service) Storage() Storage                                   { return s.storage }
func (s *Service) SetAssetInvalidator(invalidator AssetInvalidator)   { s.invalidator = invalidator }
func (s *Service) MaximumSourceBytes() int64                          { return s.cfg.SourceFetch.MaximumBytes }
func (s *Service) SetContentDefinitions(catalog *contentdefs.Catalog) { s.definitions = catalog }
func (s *Service) ContentDefinitions() *contentdefs.Catalog           { return s.definitions }

func (s *Service) CreateUpload(ctx context.Context, userID uuid.UUID, filename, mimeType string, size int64) (Upload, error) {
	filename = strings.TrimSpace(filename)
	mimeType = strings.TrimSpace(mimeType)
	if filename == "" || len(filename) > 255 {
		return Upload{}, errors.New("filename must be between 1 and 255 characters")
	}
	if size <= 0 {
		return Upload{}, errors.New("sizeBytes must be positive")
	}
	if size > s.cfg.MaxUploadBytes {
		return Upload{}, ErrUploadTooLarge
	}
	available, err := s.storage.AvailableBytes()
	if err != nil {
		return Upload{}, fmt.Errorf("check media storage: %w", err)
	}
	if uint64(size) > available || available-uint64(size) < s.cfg.ReservedFreeBytes {
		return Upload{}, ErrInsufficientSpace
	}
	var organizationID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton=TRUE`).Scan(&organizationID); err != nil {
		return Upload{}, err
	}
	upload := Upload{ID: uuid.New(), OriginalFilename: filename, DeclaredMIMEType: mimeType, ExpectedSize: size, Status: UploadPending, ExpiresAt: time.Now().UTC().Add(UploadLifetime), MaximumSize: s.cfg.MaxUploadBytes}
	key := UploadKey(upload.ID)
	file, err := s.storage.CreateUpload(key)
	if err != nil {
		return Upload{}, err
	}
	if err := file.Close(); err != nil {
		return Upload{}, err
	}
	_, err = s.db.Exec(ctx, `INSERT INTO upload_sessions (id,organization_id,created_by,original_filename,declared_mime_type,expected_size,temporary_storage_key,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, upload.ID, organizationID, userID, filename, mimeType, size, key, upload.Status, upload.ExpiresAt)
	if err != nil {
		_ = s.storage.Delete(key)
		return Upload{}, fmt.Errorf("create upload session: %w", err)
	}
	upload.UploadEndpoint = "/api/v1/uploads/" + upload.ID.String()
	return upload, nil
}

func (s *Service) GetUpload(ctx context.Context, id, userID uuid.UUID) (Upload, error) {
	var u Upload
	u.ID = id
	err := s.db.QueryRow(ctx, `SELECT original_filename,declared_mime_type,expected_size,current_offset,status,expires_at,resulting_asset_id FROM upload_sessions WHERE id=$1 AND created_by=$2`, id, userID).Scan(&u.OriginalFilename, &u.DeclaredMIMEType, &u.ExpectedSize, &u.CurrentOffset, &u.Status, &u.ExpiresAt, &u.ResultingAssetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Upload{}, ErrNotFound
	}
	if err != nil {
		return Upload{}, err
	}
	u.UploadEndpoint = "/api/v1/uploads/" + id.String()
	u.MaximumSize = s.cfg.MaxUploadBytes
	return u, nil
}

func (s *Service) AppendUpload(ctx context.Context, id, userID uuid.UUID, expectedOffset int64, body io.Reader) (Upload, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Upload{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var u Upload
	var key string
	u.ID = id
	err = tx.QueryRow(ctx, `SELECT original_filename,declared_mime_type,expected_size,current_offset,status,expires_at,temporary_storage_key FROM upload_sessions WHERE id=$1 AND created_by=$2 FOR UPDATE`, id, userID).Scan(&u.OriginalFilename, &u.DeclaredMIMEType, &u.ExpectedSize, &u.CurrentOffset, &u.Status, &u.ExpiresAt, &key)
	if errors.Is(err, pgx.ErrNoRows) {
		return Upload{}, ErrNotFound
	}
	if err != nil {
		return Upload{}, err
	}
	if time.Now().After(u.ExpiresAt) {
		_, _ = tx.Exec(ctx, `UPDATE upload_sessions SET status='expired',failure_code='upload_expired' WHERE id=$1`, id)
		_ = tx.Commit(ctx)
		return Upload{}, ErrUploadExpired
	}
	if u.Status != UploadPending && u.Status != UploadUploading {
		return Upload{}, ErrUploadUnavailable
	}
	if expectedOffset != u.CurrentOffset {
		return Upload{}, ErrOffsetMismatch
	}
	file, err := s.storage.CreateUpload(key)
	if err != nil {
		return Upload{}, err
	}
	defer file.Close()
	if _, err := file.Seek(u.CurrentOffset, io.SeekStart); err != nil {
		return Upload{}, err
	}
	remaining := u.ExpectedSize - u.CurrentOffset
	written, copyErr := io.Copy(file, io.LimitReader(body, remaining+1))
	if copyErr != nil || written > remaining {
		_ = file.Truncate(u.CurrentOffset)
		if copyErr != nil {
			return Upload{}, copyErr
		}
		return Upload{}, ErrUploadTooLarge
	}
	if err := file.Sync(); err != nil {
		_ = file.Truncate(u.CurrentOffset)
		return Upload{}, err
	}
	u.CurrentOffset += written
	u.Status = UploadUploading
	if _, err := tx.Exec(ctx, `UPDATE upload_sessions SET current_offset=$1,status='uploading' WHERE id=$2`, u.CurrentOffset, id); err != nil {
		_ = file.Truncate(expectedOffset)
		return Upload{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		_ = file.Truncate(expectedOffset)
		return Upload{}, err
	}
	u.UploadEndpoint = "/api/v1/uploads/" + id.String()
	u.MaximumSize = s.cfg.MaxUploadBytes
	return u, nil
}

func (s *Service) FinalizeUpload(ctx context.Context, id, userID uuid.UUID) (Asset, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var status UploadStatus
	var key, filename, declared string
	var expected, offset int64
	var expires time.Time
	var existing *uuid.UUID
	var organizationID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT organization_id,original_filename,declared_mime_type,expected_size,current_offset,temporary_storage_key,status,expires_at,resulting_asset_id FROM upload_sessions WHERE id=$1 AND created_by=$2 FOR UPDATE`, id, userID).Scan(&organizationID, &filename, &declared, &expected, &offset, &key, &status, &expires, &existing)
	if errors.Is(err, pgx.ErrNoRows) {
		return Asset{}, ErrNotFound
	}
	if err != nil {
		return Asset{}, err
	}
	if status == UploadFinalized && existing != nil {
		_ = tx.Commit(ctx)
		return s.GetAsset(ctx, *existing)
	}
	if time.Now().After(expires) {
		return Asset{}, ErrUploadExpired
	}
	if status != UploadPending && status != UploadUploading {
		return Asset{}, ErrUploadUnavailable
	}
	if offset != expected {
		return Asset{}, ErrUploadIncomplete
	}
	if _, err := tx.Exec(ctx, `UPDATE upload_sessions SET status='finalizing' WHERE id=$1`, id); err != nil {
		return Asset{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Asset{}, err
	}

	file, err := s.storage.Open(key)
	if err != nil {
		return Asset{}, s.failUpload(ctx, id, "media_inspection_failed", err)
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.Size() != expected {
		return Asset{}, s.failUpload(ctx, id, "upload_incomplete", ErrUploadIncomplete)
	}
	hasher := sha256.New()
	header := make([]byte, 512)
	n, err := io.ReadFull(file, header)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) {
		return Asset{}, s.failUpload(ctx, id, "media_inspection_failed", err)
	}
	header = header[:n]
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return Asset{}, err
	}
	if _, err := io.Copy(hasher, file); err != nil {
		return Asset{}, s.failUpload(ctx, id, "media_inspection_failed", err)
	}
	sum := hasher.Sum(nil)
	detected, err := DetectType(header)
	if err != nil {
		return Asset{}, s.failUpload(ctx, id, "unsupported_media_type", err)
	}
	assetID, variantID := uuid.New(), uuid.New()
	finalKey := OriginalKey(assetID, detected.Extension)
	if err := s.storage.Commit(key, finalKey); err != nil {
		return Asset{}, s.failUpload(ctx, id, "media_inspection_failed", err)
	}
	failFinalization := func(activeTx pgx.Tx, cause error) (Asset, error) {
		// Release the failed transaction before updating the upload session through
		// the pool; otherwise a saturated pool can deadlock the failure path.
		if activeTx != nil {
			_ = activeTx.Rollback(ctx)
		}
		if cleanupErr := s.storage.Delete(finalKey); cleanupErr != nil {
			cause = fmt.Errorf("%w (final media cleanup failed: %v)", cause, cleanupErr)
		}
		return Asset{}, s.failUpload(ctx, id, "media_finalization_failed", cause)
	}
	now := time.Now().UTC()
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	if strings.TrimSpace(name) == "" {
		name = "Untitled media"
	}
	if len(name) > 180 {
		name = name[:180]
	}
	finalizationTx, err := s.db.Begin(ctx)
	if err != nil {
		return failFinalization(nil, err)
	}
	defer finalizationTx.Rollback(ctx) //nolint:errcheck
	_, err = finalizationTx.Exec(ctx, `INSERT INTO assets (id,organization_id,name,type,original_filename,declared_mime_type,detected_mime_type,sha256,original_size,processing_status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11,$11)`, assetID, organizationID, name, detected.AssetType, filename, declared, detected.MIMEType, sum, expected, userID, now)
	if err != nil {
		return failFinalization(finalizationTx, err)
	}
	_, err = finalizationTx.Exec(ctx, `INSERT INTO asset_variants (id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256) VALUES ($1,$2,'original','local',$3,$4,$5,$6)`, variantID, assetID, finalKey, detected.MIMEType, expected, sum)
	if err != nil {
		return failFinalization(finalizationTx, err)
	}
	_, err = finalizationTx.Exec(ctx, `INSERT INTO media_jobs (id,asset_id,kind,status) VALUES ($1,$2,'inspect_asset','queued')`, uuid.New(), assetID)
	if err != nil {
		return failFinalization(finalizationTx, err)
	}
	_, err = finalizationTx.Exec(ctx, `UPDATE upload_sessions SET status='finalized',completed_at=$2,resulting_asset_id=$3 WHERE id=$1`, id, now, assetID)
	if err != nil {
		return failFinalization(finalizationTx, err)
	}
	_, err = finalizationTx.Exec(ctx, `INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id,metadata) VALUES ($1,$2,'media.upload_finalized','asset',$3,jsonb_build_object('filename',$4::text,'sizeBytes',$5::bigint))`, uuid.New(), userID, assetID.String(), filename, expected)
	if err != nil {
		return failFinalization(finalizationTx, err)
	}
	if err := finalizationTx.Commit(ctx); err != nil {
		return Asset{}, err
	}
	return s.GetAsset(ctx, assetID)
}

func (s *Service) failUpload(ctx context.Context, id uuid.UUID, code string, cause error) error {
	_, _ = s.db.Exec(ctx, `UPDATE upload_sessions SET status='failed',failure_code=$2 WHERE id=$1`, id, code)
	return cause
}

func (s *Service) CancelUpload(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var key string
	var status UploadStatus
	err = tx.QueryRow(ctx, `SELECT temporary_storage_key,status FROM upload_sessions WHERE id=$1 AND created_by=$2 FOR UPDATE`, id, userID).Scan(&key, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status == UploadFinalized {
		return ErrUploadUnavailable
	}
	if status == UploadCancelled {
		return nil
	}
	if _, err = tx.Exec(ctx, `UPDATE upload_sessions SET status='cancelled',failure_code=NULL WHERE id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id) VALUES ($1,$2,'media.upload_cancelled','upload',$3)`, uuid.New(), userID, id.String()); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	return s.storage.Delete(key)
}

// assetOrigin returns the origin ('library' or 'form_attachment') of a live asset, or ErrNotFound.
// It backs the guards that keep form-submission attachments out of every generic Media surface.
func (s *Service) assetOrigin(ctx context.Context, id uuid.UUID) (string, error) {
	var origin string
	err := s.db.QueryRow(ctx, `SELECT origin FROM assets WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&origin)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return origin, err
}

// GetAsset returns a library or widget asset. Form-submission attachments (origin='form_attachment')
// are never returned here: they are reachable only through the record-scoped Form attachment
// endpoint and authorized Player delivery, so the generic Media detail surface treats them as absent.
func (s *Service) GetAsset(ctx context.Context, id uuid.UUID) (Asset, error) {
	return s.getAsset(ctx, id, false)
}

func (s *Service) getAsset(ctx context.Context, id uuid.UUID, allowFormAttachment bool) (Asset, error) {
	if !allowFormAttachment {
		origin, err := s.assetOrigin(ctx, id)
		if err != nil {
			return Asset{}, err
		}
		if origin == "form_attachment" {
			return Asset{}, ErrNotFound
		}
	}
	row := s.db.QueryRow(ctx, assetSelect+` WHERE a.id=$1 AND a.deleted_at IS NULL AND a.archived_at IS NULL AND (a.expires_at IS NULL OR a.expires_at>now())`, id)
	asset, err := scanAsset(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Asset{}, ErrNotFound
	}
	if err != nil {
		return Asset{}, err
	}
	asset.Variants, err = s.variants(ctx, id)
	if err != nil {
		return Asset{}, err
	}
	if asset.Type == "widget" {
		asset.Widget, err = s.loadWidget(ctx, id)
		if err != nil {
			return Asset{}, err
		}
		if asset.Widget != nil && asset.Widget.Provider == "website" {
			asset.Website, err = s.loadWebsite(ctx, id)
			if err != nil {
				return Asset{}, err
			}
		}
	}
	_ = s.db.QueryRow(ctx, `SELECT count(DISTINCT playlist_id) FROM playlist_items WHERE asset_id=$1`, id).Scan(&asset.PlaylistUsage)
	asset.PlaylistsUsing, err = s.playlistUsage(ctx, id)
	if err != nil {
		return Asset{}, err
	}
	asset.LayoutUsage, err = s.layoutUsage(ctx, id)
	if err != nil {
		return Asset{}, err
	}
	if err = s.loadOrganization(ctx, &asset); err != nil {
		return Asset{}, err
	}
	for _, v := range asset.Variants {
		if v.Kind == "thumbnail" || v.Kind == "poster" {
			url := "/api/v1/assets/" + id.String() + "/thumbnail"
			asset.ThumbnailURL = &url
			break
		}
	}
	return asset, nil
}

const assetSelect = `SELECT a.id,a.name,a.description,a.type,a.original_filename,a.declared_mime_type,a.detected_mime_type,encode(a.sha256,'hex'),a.original_size,a.width,a.height,a.duration_seconds,a.frame_rate,a.video_codec,a.audio_codec,a.audio_channels,a.metadata,a.processing_status,a.processing_progress,a.error_code,a.error_message,u.id,u.name,a.created_at,a.updated_at,a.available_from,a.expires_at,a.archived_at,(EXISTS(SELECT 1 FROM asset_variants preview WHERE preview.asset_id=a.id AND preview.deleted_at IS NULL AND preview.kind IN ('thumbnail','poster')) OR EXISTS(SELECT 1 FROM widgets widget_preview WHERE widget_preview.asset_id=a.id AND widget_preview.preview_image IS NOT NULL)) FROM assets a LEFT JOIN users u ON u.id=a.created_by`

type rowScanner interface{ Scan(...any) error }

func scanAsset(row rowScanner) (Asset, error) {
	var a Asset
	var metadata []byte
	var creatorID *uuid.UUID
	var creatorName *string
	var hasPreview bool
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.Type, &a.OriginalFilename, &a.DeclaredMIMEType, &a.DetectedMIMEType, &a.SHA256, &a.OriginalSize, &a.Width, &a.Height, &a.Duration, &a.FrameRate, &a.VideoCodec, &a.AudioCodec, &a.AudioChannels, &metadata, &a.ProcessingStatus, &a.ProcessingProgress, &a.ErrorCode, &a.ErrorMessage, &creatorID, &creatorName, &a.CreatedAt, &a.UpdatedAt, &a.AvailableFrom, &a.ExpiresAt, &a.ArchivedAt, &hasPreview)
	if err != nil {
		return Asset{}, err
	}
	_ = json.Unmarshal(metadata, &a.Metadata)
	if a.Metadata == nil {
		a.Metadata = map[string]any{}
	}
	if creatorID != nil {
		a.Creator = &Creator{ID: *creatorID, Name: *creatorName}
	}
	if hasPreview {
		url := "/api/v1/assets/" + a.ID.String() + "/thumbnail"
		a.ThumbnailURL = &url
	}
	a.Variants = []Variant{}
	a.LayoutUsage = []LayoutUsage{}
	return a, nil
}

func (s *Service) variants(ctx context.Context, assetID uuid.UUID) ([]Variant, error) {
	rows, err := s.db.Query(ctx, `SELECT id,kind,mime_type,file_size,encode(sha256,'hex'),width,height,duration_seconds,frame_rate,video_codec,audio_codec,player_compatible,created_at FROM asset_variants WHERE asset_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Variant{}
	for rows.Next() {
		var v Variant
		if err := rows.Scan(&v.ID, &v.Kind, &v.MIMEType, &v.FileSize, &v.SHA256, &v.Width, &v.Height, &v.Duration, &v.FrameRate, &v.VideoCodec, &v.AudioCodec, &v.PlayerCompatible, &v.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

// playlistUsage names the playlists containing an asset. Only the detail read calls this; the
// list read keeps its cheap count so a paged response does not grow a second per-row query.
func (s *Service) playlistUsage(ctx context.Context, assetID uuid.UUID) ([]PlaylistUsage, error) {
	rows, err := s.db.Query(ctx, `SELECT p.id,p.name FROM playlists p JOIN playlist_items i ON i.playlist_id=p.id WHERE i.asset_id=$1 AND p.deleted_at IS NULL GROUP BY p.id,p.name ORDER BY lower(p.name),p.id`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []PlaylistUsage{}
	for rows.Next() {
		var usage PlaylistUsage
		if err = rows.Scan(&usage.ID, &usage.Name); err != nil {
			return nil, err
		}
		result = append(result, usage)
	}
	return result, rows.Err()
}

func (s *Service) layoutUsage(ctx context.Context, assetID uuid.UUID) ([]LayoutUsage, error) {
	rows, err := s.db.Query(ctx, `SELECT l.id,l.name,bool_or(l.published_revision_id IS NOT NULL) FROM layouts l WHERE l.deleted_at IS NULL AND (EXISTS(SELECT 1 FROM layout_draft_dependencies d WHERE d.layout_id=l.id AND d.dependency_id=$1 AND d.dependency_type IN('widget','asset')) OR EXISTS(SELECT 1 FROM layout_revisions r JOIN layout_revision_dependencies d ON d.revision_id=r.id WHERE r.layout_id=l.id AND d.dependency_id=$1 AND d.dependency_type IN('widget','asset'))) GROUP BY l.id,l.name ORDER BY lower(l.name),l.id`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []LayoutUsage{}
	for rows.Next() {
		var usage LayoutUsage
		if err = rows.Scan(&usage.ID, &usage.Name, &usage.Published); err != nil {
			return nil, err
		}
		result = append(result, usage)
	}
	return result, rows.Err()
}

func (s *Service) ListAssets(ctx context.Context, o ListOptions) (ListResult, error) {
	if o.Page < 1 {
		o.Page = 1
	}
	if o.PageSize < 1 {
		o.PageSize = 24
	}
	if o.PageSize > 100 {
		o.PageSize = 100
	}
	sortSQL := "a.created_at DESC,a.id DESC"
	switch o.Sort {
	case "oldest":
		sortSQL = "a.created_at ASC,a.id ASC"
	case "name":
		sortSQL = "lower(a.name) ASC,a.id ASC"
	case "updated":
		sortSQL = "a.updated_at DESC,a.id DESC"
	}
	if o.Archived && o.Sort == "updated" {
		sortSQL = "COALESCE(a.archived_at,a.expires_at) DESC,a.id DESC"
	}
	// Form submission attachments (origin='form_attachment') are managed through their Form Data
	// Source and must never appear in the public Media library or its pickers.
	where := []string{
		"a.deleted_at IS NULL",
		"a.origin='library'",
		"a.system_managed=FALSE",
	}
	if o.Archived {
		where = append(where, "(a.archived_at IS NOT NULL OR (a.expires_at IS NOT NULL AND a.expires_at<=now()))")
	} else {
		where = append(where, "a.archived_at IS NULL", "(a.expires_at IS NULL OR a.expires_at>now())")
	}
	args := []any{}
	add := func(query string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(query, len(args)))
	}
	if q := strings.TrimSpace(o.Search); q != "" {
		add("a.name ILIKE '%%' || $%d || '%%'", q)
	}
	if o.Type != "" {
		if o.Type == "media" {
			where = append(where, "a.type IN ('image','video')")
		} else {
			add("a.type=$%d", o.Type)
		}
	}
	if o.WidgetProvider != "" {
		add("EXISTS(SELECT 1 FROM widgets wf WHERE wf.asset_id=a.id AND wf.provider=$%d)", o.WidgetProvider)
	}
	if o.Status != "" {
		add("a.processing_status=$%d", o.Status)
	}
	if o.FolderID != nil {
		add("a.folder_id=$%d", *o.FolderID)
	}
	if o.CollectionID != nil {
		add("EXISTS(SELECT 1 FROM content_collection_assets ca WHERE ca.asset_id=a.id AND ca.collection_id=$%d)", *o.CollectionID)
	}
	if o.TagID != nil {
		add("EXISTS(SELECT 1 FROM content_asset_tags at WHERE at.asset_id=a.id AND at.tag_id=$%d)", *o.TagID)
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(ctx, "SELECT count(*) FROM assets a WHERE "+clause, args...).Scan(&total); err != nil {
		return ListResult{}, err
	}
	args = append(args, o.PageSize, (o.Page-1)*o.PageSize)
	rows, err := s.db.Query(ctx, assetSelect+" WHERE "+clause+" ORDER BY "+sortSQL+fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args)), args...)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()
	items := []Asset{}
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			return ListResult{}, err
		}
		if a.Type == "widget" {
			a.Widget, err = s.loadWidget(ctx, a.ID)
			if err != nil {
				return ListResult{}, err
			}
			if a.Widget != nil && a.Widget.Provider == "website" {
				a.Website, err = s.loadWebsite(ctx, a.ID)
				if err != nil {
					return ListResult{}, err
				}
			}
		}
		if o.Archived && a.ArchivedAt == nil && a.ExpiresAt != nil {
			a.ArchivedAt = a.ExpiresAt
		}
		_ = s.db.QueryRow(ctx, `SELECT count(DISTINCT playlist_id) FROM playlist_items WHERE asset_id=$1`, a.ID).Scan(&a.PlaylistUsage)
		a.LayoutUsage, err = s.layoutUsage(ctx, a.ID)
		if err != nil {
			return ListResult{}, err
		}
		if err = s.loadOrganization(ctx, &a); err != nil {
			return ListResult{}, err
		}
		items = append(items, a)
	}
	return ListResult{Items: items, Total: total, Page: o.Page, PageSize: o.PageSize}, rows.Err()
}

func (s *Service) UpdateAsset(ctx context.Context, id, userID uuid.UUID, name, description *string) (Asset, error) {
	return s.updateAsset(ctx, id, userID, name, description, false, nil, nil)
}

func (s *Service) UpdateAssetAvailability(ctx context.Context, id, userID uuid.UUID, name, description *string, availableFrom, expiresAt *time.Time) (Asset, error) {
	return s.updateAsset(ctx, id, userID, name, description, true, availableFrom, expiresAt)
}

func (s *Service) updateAsset(ctx context.Context, id, userID uuid.UUID, name, description *string, availabilitySet bool, availableFrom, expiresAt *time.Time) (Asset, error) {
	// Form attachments are not editable through the generic Media surface.
	if origin, err := s.assetOrigin(ctx, id); err != nil {
		return Asset{}, err
	} else if origin == "form_attachment" {
		return Asset{}, ErrNotFound
	}
	if name != nil {
		v := strings.TrimSpace(*name)
		if v == "" || len(v) > 180 {
			return Asset{}, errors.New("name must be between 1 and 180 characters")
		}
		name = &v
	}
	if description != nil && len(*description) > 2000 {
		return Asset{}, errors.New("description must be at most 2000 characters")
	}
	if availabilitySet && availableFrom != nil && expiresAt != nil && !availableFrom.Before(*expiresAt) {
		return Asset{}, errors.New("availableFrom must be before expiresAt")
	}
	if availabilitySet && expiresAt != nil && !expiresAt.After(time.Now()) {
		return Asset{}, errors.New("expiresAt must be in the future")
	}
	tag, err := s.db.Exec(ctx, `UPDATE assets SET name=COALESCE($2,name),description=COALESCE($3,description),available_from=CASE WHEN $4 THEN $5 ELSE available_from END,expires_at=CASE WHEN $4 THEN $6 ELSE expires_at END,updated_at=now() WHERE id=$1 AND deleted_at IS NULL AND archived_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, id, name, description, availabilitySet, availableFrom, expiresAt)
	if err != nil {
		return Asset{}, err
	}
	if tag.RowsAffected() == 0 {
		return Asset{}, ErrNotFound
	}
	action := "media.asset_updated"
	if name != nil {
		action = "media.asset_renamed"
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,'asset',$4)`, uuid.New(), userID, action, id.String())
	if availabilitySet && s.invalidator != nil {
		_ = s.invalidator.AssetChanged(ctx, id, "media.availability_updated")
	}
	return s.GetAsset(ctx, id)
}

func (s *Service) RetryAsset(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var status AssetStatus
	var origin string
	if err = tx.QueryRow(ctx, `SELECT processing_status,origin FROM assets WHERE id=$1 AND deleted_at IS NULL AND archived_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE`, id).Scan(&status, &origin); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// Form attachments are not retryable through the generic Media surface.
	if origin == "form_attachment" {
		return ErrNotFound
	}
	if status != StatusFailed {
		return errors.New("only failed assets can be retried")
	}
	_, err = tx.Exec(ctx, `UPDATE assets SET processing_status='queued',processing_progress=NULL,error_code=NULL,error_message=NULL,updated_at=now() WHERE id=$1`, id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO media_jobs(id,asset_id,kind,status)VALUES($1,$2,'inspect_asset','queued') ON CONFLICT DO NOTHING`, uuid.New(), id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'media.processing_retried','asset',$3)`, uuid.New(), userID, id.String())
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ArchiveAssets moves unused library assets out of the active library without
// deleting their files or organization. The whole selection is validated before any row moves.
func (s *Service) ArchiveAssets(ctx context.Context, ids []uuid.UUID, userID uuid.UUID) error {
	if len(ids) == 0 || len(ids) > 100 {
		return errors.New("assetIds must contain between 1 and 100 assets")
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			return errors.New("assetIds must not contain duplicates")
		}
		seen[id] = struct{}{}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM assets WHERE id=ANY($1) AND deleted_at IS NULL AND archived_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND origin='library' AND system_managed=FALSE`, ids).Scan(&count); err != nil {
		return err
	}
	if count != len(ids) {
		return ErrNotFound
	}
	for _, id := range ids {
		var inUse bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlist_items WHERE asset_id=$1) OR EXISTS(SELECT 1 FROM website_assets WHERE fallback_image_asset_id=$1) OR EXISTS(SELECT 1 FROM widgets JOIN assets widget_asset ON widget_asset.id=widgets.asset_id AND widget_asset.deleted_at IS NULL WHERE widgets.configuration->>'fallbackImageAssetId'=$1::text) OR EXISTS(SELECT 1 FROM organization_runtime_settings WHERE settings->>'branding.logo_asset_id'=$1::text OR settings->>'branding.icon_asset_id'=$1::text) OR EXISTS(SELECT 1 FROM layout_draft_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset')) OR EXISTS(SELECT 1 FROM layout_revision_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset'))`, id).Scan(&inUse); err != nil {
			return err
		}
		if inUse {
			return errors.New("asset is in use by a playlist, Layout, or shared configuration")
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE assets SET archived_at=now(),updated_at=now() WHERE id=ANY($1)`, ids); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'media.asset_archived','asset',$3)`, uuid.New(), userID, id.String()); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if s.invalidator != nil {
		for _, id := range ids {
			_ = s.invalidator.AssetChanged(ctx, id, "media.asset_archived")
		}
	}
	return nil
}

func (s *Service) RestoreAssets(ctx context.Context, ids []uuid.UUID, userID uuid.UUID) error {
	if len(ids) == 0 || len(ids) > 100 {
		return errors.New("assetIds must contain between 1 and 100 assets")
	}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			return errors.New("assetIds must not contain duplicates")
		}
		seen[id] = struct{}{}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE assets SET archived_at=NULL,expires_at=CASE WHEN expires_at<=now() THEN NULL ELSE expires_at END,updated_at=now() WHERE id=ANY($1) AND deleted_at IS NULL AND (archived_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at<=now())) AND origin='library' AND system_managed=FALSE`, ids)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != int64(len(ids)) {
		return ErrNotFound
	}
	for _, id := range ids {
		if _, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'media.asset_restored','asset',$3)`, uuid.New(), userID, id.String()); err != nil {
			return err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if s.invalidator != nil {
		for _, id := range ids {
			_ = s.invalidator.AssetChanged(ctx, id, "media.asset_restored")
		}
	}
	return nil
}

func (s *Service) DeleteAsset(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var inUse bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlist_items WHERE asset_id=$1) OR EXISTS(SELECT 1 FROM website_assets WHERE fallback_image_asset_id=$1) OR EXISTS(SELECT 1 FROM widgets JOIN assets widget_asset ON widget_asset.id=widgets.asset_id AND widget_asset.deleted_at IS NULL WHERE widgets.configuration->>'fallbackImageAssetId'=$1::text) OR EXISTS(SELECT 1 FROM organization_runtime_settings WHERE settings->>'branding.logo_asset_id'=$1::text OR settings->>'branding.icon_asset_id'=$1::text) OR EXISTS(SELECT 1 FROM layout_draft_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset')) OR EXISTS(SELECT 1 FROM layout_revision_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset'))`, id).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return errors.New("asset is in use by a playlist, Layout, or shared configuration")
	}
	var assetType, assetOrigin string
	if err := tx.QueryRow(ctx, `SELECT type,origin FROM assets WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&assetType, &assetOrigin); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	// Form attachments are removed only through the record-scoped Form attachment endpoint.
	if assetOrigin == "form_attachment" {
		return ErrNotFound
	}
	tag, err := tx.Exec(ctx, `UPDATE assets SET processing_status='deleting',deleted_at=COALESCE(deleted_at,now()),updated_at=now() WHERE id=$1 AND processing_status NOT IN ('deleting','deleted')`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id=$1)`, id).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		return nil
	}
	if assetType == "widget" {
		if _, err = tx.Exec(ctx, `DELETE FROM website_assets WHERE asset_id=$1`, id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `DELETE FROM widgets WHERE asset_id=$1`, id); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE assets SET processing_status='deleted' WHERE id=$1`, id); err != nil {
			return err
		}
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO media_jobs(id,asset_id,kind,status)VALUES($1,$2,'delete_asset_files','queued') ON CONFLICT DO NOTHING`, uuid.New(), id)
		if err != nil {
			return err
		}
	}
	action := "media.asset_deleted"
	if assetType == "widget" {
		action = "widget.deleted"
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,'asset',$4)`, uuid.New(), userID, action, id.String())
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) Delivery(ctx context.Context, assetID, variantID uuid.UUID) (Delivery, error) {
	var d Delivery
	d.AssetID = assetID
	d.VariantID = variantID
	var key string
	err := s.db.QueryRow(ctx, `SELECT v.storage_key,v.mime_type,v.file_size,encode(v.sha256,'hex') FROM asset_variants v JOIN assets a ON a.id=v.asset_id WHERE a.id=$1 AND v.id=$2 AND a.deleted_at IS NULL AND a.processing_status='ready' AND v.deleted_at IS NULL AND v.player_compatible=TRUE`, assetID, variantID).Scan(&key, &d.MIMEType, &d.Size, &d.HashHex)
	if errors.Is(err, pgx.ErrNoRows) {
		return Delivery{}, ErrVariantUnavailable
	}
	if err != nil {
		return Delivery{}, err
	}
	d.Path, err = s.storage.Path(key)
	if err != nil {
		return Delivery{}, err
	}
	info, err := os.Stat(d.Path)
	if err != nil || info.Size() != d.Size {
		return Delivery{}, ErrVariantUnavailable
	}
	return d, nil
}

func (s *Service) Preview(ctx context.Context, assetID uuid.UUID) (Delivery, error) {
	var d Delivery
	d.AssetID = assetID
	var key string
	// Form attachments are excluded: they are served only through the record-scoped endpoint.
	err := s.db.QueryRow(ctx, `SELECT v.id,v.storage_key,v.mime_type,v.file_size,encode(v.sha256,'hex') FROM asset_variants v JOIN assets a ON a.id=v.asset_id WHERE a.id=$1 AND a.deleted_at IS NULL AND a.origin<>'form_attachment' AND v.deleted_at IS NULL AND v.kind IN ('thumbnail','poster') ORDER BY CASE v.kind WHEN 'thumbnail' THEN 0 ELSE 1 END LIMIT 1`, assetID).Scan(&d.VariantID, &key, &d.MIMEType, &d.Size, &d.HashHex)
	if errors.Is(err, pgx.ErrNoRows) {
		return Delivery{}, ErrVariantUnavailable
	}
	if err != nil {
		return Delivery{}, err
	}
	d.Path, err = s.storage.Path(key)
	return d, err
}

func (s *Service) PlaybackPreview(ctx context.Context, assetID uuid.UUID) (Delivery, error) {
	var variantID uuid.UUID
	// Form attachments are excluded: the generic playback-preview surface must not serve them.
	err := s.db.QueryRow(ctx, `SELECT v.id FROM asset_variants v JOIN assets a ON a.id=v.asset_id WHERE a.id=$1 AND a.deleted_at IS NULL AND a.origin<>'form_attachment' AND a.processing_status='ready' AND a.type IN ('image','video') AND v.deleted_at IS NULL AND v.player_compatible=TRUE ORDER BY CASE v.kind WHEN 'playback' THEN 0 WHEN 'original' THEN 1 ELSE 2 END LIMIT 1`, assetID).Scan(&variantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Delivery{}, ErrVariantUnavailable
	}
	if err != nil {
		return Delivery{}, err
	}
	return s.Delivery(ctx, assetID, variantID)
}

func ETag(hashHex string) string {
	return `"sha256-` + strings.ToLower(hashHex) + `"`
}

func (s *Service) Diagnostics() (map[string]any, error) {
	if err := s.storage.CheckWritable(); err != nil {
		return nil, err
	}
	available, err := s.storage.AvailableBytes()
	if err != nil {
		return nil, err
	}
	return map[string]any{"availableStorageBytes": available, "maximumUploadBytes": s.cfg.MaxUploadBytes, "workerCount": s.cfg.Workers, "ffmpegAvailable": executableAvailable(s.cfg.FFmpegPath), "ffprobeAvailable": executableAvailable(s.cfg.FFprobePath)}, nil
}
func executableAvailable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}
