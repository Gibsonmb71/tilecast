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
)

const UploadLifetime = 24 * time.Hour

type Config struct {
	MaxUploadBytes          int64
	ReservedFreeBytes       uint64
	FFmpegPath, FFprobePath string
	Profile                 CompatibilityProfile
	Workers                 int
	KeepOriginals           bool
}
type Service struct {
	db      *pgxpool.Pool
	storage Storage
	cfg     Config
}

func NewService(db *pgxpool.Pool, storage Storage, cfg Config) *Service {
	return &Service{db: db, storage: storage, cfg: cfg}
}
func (s *Service) Storage() Storage { return s.storage }

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
	now := time.Now().UTC()
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	if strings.TrimSpace(name) == "" {
		name = "Untitled media"
	}
	if len(name) > 180 {
		name = name[:180]
	}
	tx, err = s.db.Begin(ctx)
	if err != nil {
		return Asset{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	_, err = tx.Exec(ctx, `INSERT INTO assets (id,organization_id,name,type,original_filename,declared_mime_type,detected_mime_type,sha256,original_size,processing_status,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11,$11)`, assetID, organizationID, name, detected.AssetType, filename, declared, detected.MIMEType, sum, expected, userID, now)
	if err != nil {
		return Asset{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO asset_variants (id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256) VALUES ($1,$2,'original','local',$3,$4,$5,$6)`, variantID, assetID, finalKey, detected.MIMEType, expected, sum)
	if err != nil {
		return Asset{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO media_jobs (id,asset_id,kind,status) VALUES ($1,$2,'inspect_asset','queued')`, uuid.New(), assetID)
	if err != nil {
		return Asset{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE upload_sessions SET status='finalized',completed_at=$2,resulting_asset_id=$3 WHERE id=$1`, id, now, assetID)
	if err != nil {
		return Asset{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id,metadata) VALUES ($1,$2,'media.upload_finalized','asset',$3,jsonb_build_object('filename',$4::text,'sizeBytes',$5::bigint))`, uuid.New(), userID, assetID.String(), filename, expected)
	if err != nil {
		return Asset{}, err
	}
	if err := tx.Commit(ctx); err != nil {
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

func (s *Service) GetAsset(ctx context.Context, id uuid.UUID) (Asset, error) {
	row := s.db.QueryRow(ctx, assetSelect+` WHERE a.id=$1 AND a.deleted_at IS NULL`, id)
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
	for _, v := range asset.Variants {
		if v.Kind == "thumbnail" || v.Kind == "poster" {
			url := "/api/v1/assets/" + id.String() + "/thumbnail"
			asset.ThumbnailURL = &url
			break
		}
	}
	return asset, nil
}

const assetSelect = `SELECT a.id,a.name,a.description,a.type,a.original_filename,a.declared_mime_type,a.detected_mime_type,encode(a.sha256,'hex'),a.original_size,a.width,a.height,a.duration_seconds,a.frame_rate,a.video_codec,a.audio_codec,a.audio_channels,a.metadata,a.processing_status,a.processing_progress,a.error_code,a.error_message,u.id,u.name,a.created_at,a.updated_at FROM assets a LEFT JOIN users u ON u.id=a.created_by`

type rowScanner interface{ Scan(...any) error }

func scanAsset(row rowScanner) (Asset, error) {
	var a Asset
	var metadata []byte
	var creatorID *uuid.UUID
	var creatorName *string
	err := row.Scan(&a.ID, &a.Name, &a.Description, &a.Type, &a.OriginalFilename, &a.DeclaredMIMEType, &a.DetectedMIMEType, &a.SHA256, &a.OriginalSize, &a.Width, &a.Height, &a.Duration, &a.FrameRate, &a.VideoCodec, &a.AudioCodec, &a.AudioChannels, &metadata, &a.ProcessingStatus, &a.ProcessingProgress, &a.ErrorCode, &a.ErrorMessage, &creatorID, &creatorName, &a.CreatedAt, &a.UpdatedAt)
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
	a.Variants = []Variant{}
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
	where := []string{"a.deleted_at IS NULL"}
	args := []any{}
	add := func(query string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(query, len(args)))
	}
	if q := strings.TrimSpace(o.Search); q != "" {
		add("a.name ILIKE '%%' || $%d || '%%'", q)
	}
	if o.Type != "" {
		add("a.type=$%d", o.Type)
	}
	if o.Status != "" {
		add("a.processing_status=$%d", o.Status)
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
		items = append(items, a)
	}
	return ListResult{Items: items, Total: total, Page: o.Page, PageSize: o.PageSize}, rows.Err()
}

func (s *Service) UpdateAsset(ctx context.Context, id, userID uuid.UUID, name, description *string) (Asset, error) {
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
	tag, err := s.db.Exec(ctx, `UPDATE assets SET name=COALESCE($2,name),description=COALESCE($3,description),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, name, description)
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
	return s.GetAsset(ctx, id)
}

func (s *Service) RetryAsset(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var status AssetStatus
	if err = tx.QueryRow(ctx, `SELECT processing_status FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&status); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
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

func (s *Service) DeleteAsset(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var inUse bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlist_items WHERE asset_id=$1)`, id).Scan(&inUse); err != nil {
		return err
	}
	if inUse {
		return errors.New("asset is in use by a playlist")
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
	_, err = tx.Exec(ctx, `INSERT INTO media_jobs(id,asset_id,kind,status)VALUES($1,$2,'delete_asset_files','queued') ON CONFLICT DO NOTHING`, uuid.New(), id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'media.asset_deleted','asset',$3)`, uuid.New(), userID, id.String())
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
	err := s.db.QueryRow(ctx, `SELECT v.id,v.storage_key,v.mime_type,v.file_size,encode(v.sha256,'hex') FROM asset_variants v JOIN assets a ON a.id=v.asset_id WHERE a.id=$1 AND a.deleted_at IS NULL AND v.deleted_at IS NULL AND v.kind IN ('thumbnail','poster') ORDER BY CASE v.kind WHEN 'thumbnail' THEN 0 ELSE 1 END LIMIT 1`, assetID).Scan(&d.VariantID, &key, &d.MIMEType, &d.Size, &d.HashHex)
	if errors.Is(err, pgx.ErrNoRows) {
		return Delivery{}, ErrVariantUnavailable
	}
	if err != nil {
		return Delivery{}, err
	}
	d.Path, err = s.storage.Path(key)
	return d, err
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
