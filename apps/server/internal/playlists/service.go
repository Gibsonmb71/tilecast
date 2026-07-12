package playlists

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
)

type Service struct {
	db         *pgxpool.Pool
	notifier   Notifier
	scheduling *scheduling.Service
}

func NewService(db *pgxpool.Pool, notifier Notifier) *Service {
	return &Service{db: db, notifier: notifier}
}

func (s *Service) SetScheduling(service *scheduling.Service) { s.scheduling = service }

func (s *Service) Create(ctx context.Context, userID uuid.UUID, name, description string) (Playlist, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if err := validateDetails(name, description); err != nil {
		return Playlist{}, err
	}
	var org uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton=TRUE`).Scan(&org); err != nil {
		return Playlist{}, err
	}
	id := uuid.New()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO playlists(id,organization_id,name,description,created_by)VALUES($1,$2,$3,$4,$5)`, id, org, name, description, userID)
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.created", id); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	return s.Get(ctx, id)
}
func validateDetails(name, description string) error {
	if len(name) < 1 || len(name) > 180 {
		return errors.New("playlist name must be between 1 and 180 characters")
	}
	if len(description) > 2000 {
		return errors.New("playlist description must be at most 2000 characters")
	}
	return nil
}

func (s *Service) List(ctx context.Context, search string, page, pageSize int) (ListResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 30
	}
	if pageSize > 100 {
		pageSize = 100
	}
	search = strings.TrimSpace(search)
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM playlists WHERE deleted_at IS NULL AND ($1='' OR name ILIKE '%'||$1||'%')`, search).Scan(&total); err != nil {
		return ListResult{}, err
	}
	rows, err := s.db.Query(ctx, `SELECT p.id,p.name,p.description,p.revision,p.created_at,p.updated_at,count(i.id) FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id=p.id WHERE p.deleted_at IS NULL AND ($1='' OR p.name ILIKE '%'||$1||'%') GROUP BY p.id ORDER BY p.updated_at DESC,p.id LIMIT $2 OFFSET $3`, search, pageSize, (page-1)*pageSize)
	if err != nil {
		return ListResult{}, err
	}
	defer rows.Close()
	items := []Playlist{}
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Revision, &p.CreatedAt, &p.UpdatedAt, &p.ItemCount); err != nil {
			return ListResult{}, err
		}
		p.Items = []Item{}
		p.Warnings = []string{}
		items = append(items, p)
	}
	return ListResult{Items: items, Total: total, Page: page, PageSize: pageSize}, rows.Err()
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Playlist, error) {
	var p Playlist
	err := s.db.QueryRow(ctx, `SELECT id,name,description,revision,created_at,updated_at FROM playlists WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&p.ID, &p.Name, &p.Description, &p.Revision, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Playlist{}, ErrNotFound
	}
	if err != nil {
		return Playlist{}, err
	}
	rows, err := s.db.Query(ctx, `SELECT i.id,i.asset_id,i.position,i.duration_ms,i.fit_mode,i.transition,i.audio_enabled,i.volume,i.video_start_offset_ms,i.video_end_offset_ms,i.delivery_policy,a.name,a.type,a.processing_status,a.duration_seconds,v.id,i.created_at,i.updated_at FROM playlist_items i JOIN assets a ON a.id=i.asset_id LEFT JOIN LATERAL(SELECT id FROM asset_variants WHERE asset_id=a.id AND deleted_at IS NULL AND player_compatible=TRUE ORDER BY CASE kind WHEN 'playback' THEN 0 WHEN 'original' THEN 1 ELSE 2 END LIMIT 1)v ON TRUE WHERE i.playlist_id=$1 ORDER BY i.position`, id)
	if err != nil {
		return Playlist{}, err
	}
	defer rows.Close()
	p.Items = []Item{}
	p.Warnings = []string{}
	for rows.Next() {
		var item Item
		if err := rows.Scan(&item.ID, &item.AssetID, &item.Position, &item.DurationMS, &item.FitMode, &item.Transition, &item.AudioEnabled, &item.Volume, &item.VideoStartOffsetMS, &item.VideoEndOffsetMS, &item.DeliveryPolicy, &item.AssetName, &item.AssetType, &item.AssetStatus, &item.AssetDurationSeconds, &item.VariantID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return Playlist{}, err
		}
		item.ThumbnailURL = "/api/v1/assets/" + item.AssetID.String() + "/thumbnail"
		if item.AssetStatus != "ready" || (item.AssetType != "website" && item.VariantID == nil) {
			p.Warnings = append(p.Warnings, "Asset "+item.AssetName+" is no longer ready for playback.")
		}
		p.Items = append(p.Items, item)
	}
	p.ItemCount = len(p.Items)
	return p, rows.Err()
}

func (s *Service) Update(ctx context.Context, id, userID uuid.UUID, name, description string) (Playlist, error) {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if err := validateDetails(name, description); err != nil {
		return Playlist{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE playlists SET name=$2,description=$3,revision=revision+1,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, name, description)
	if err != nil {
		return Playlist{}, err
	}
	if tag.RowsAffected() == 0 {
		return Playlist{}, ErrNotFound
	}
	notifications, err := bumpAssigned(ctx, tx, id, "playlist.updated")
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.updated", id); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	s.notify(notifications)
	return s.Get(ctx, id)
}

func (s *Service) Duplicate(ctx context.Context, id, userID uuid.UUID) (Playlist, error) {
	source, err := s.Get(ctx, id)
	if err != nil {
		return Playlist{}, err
	}
	created, err := s.Create(ctx, userID, source.Name+" copy", source.Description)
	if err != nil {
		return Playlist{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO playlist_items(id,playlist_id,asset_id,position,duration_ms,fit_mode,transition,audio_enabled,volume,video_start_offset_ms,video_end_offset_ms,delivery_policy) SELECT gen_random_uuid(),$2,asset_id,position,duration_ms,fit_mode,transition,audio_enabled,volume,video_start_offset_ms,video_end_offset_ms,delivery_policy FROM playlist_items WHERE playlist_id=$1`, id, created.ID)
	if err != nil {
		return Playlist{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE playlists SET revision=revision+1 WHERE id=$1`, created.ID); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	return s.Get(ctx, created.ID)
}

func (s *Service) Delete(ctx context.Context, id, userID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var assigned int
	if err = tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM screen_playlist_assignments WHERE playlist_id=$1)+(SELECT count(*) FROM schedules WHERE playlist_id=$1 AND deleted_at IS NULL)`, id).Scan(&assigned); err != nil {
		return err
	}
	if assigned > 0 {
		return fmt.Errorf("%w: playlist is assigned to a screen", ErrConflict)
	}
	tag, err := tx.Exec(ctx, `UPDATE playlists SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err = insertAudit(ctx, tx, userID, "playlist.deleted", id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type assetInfo struct {
	Type     string
	Duration *float64
	Variant  *uuid.UUID
}

func (s *Service) validateItem(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, input ItemInput) (ItemInput, assetInfo, error) {
	if input.FitMode == "" {
		input.FitMode = "contain"
	}
	if input.Transition == "" {
		input.Transition = "none"
	}
	if input.DeliveryPolicy == "" {
		input.DeliveryPolicy = "download"
	}
	if input.AudioEnabled == nil {
		v := true
		input.AudioEnabled = &v
	}
	if input.Volume == nil {
		v := 1.0
		input.Volume = &v
	}
	if input.FitMode != "contain" && input.FitMode != "cover" && input.FitMode != "stretch" {
		return input, assetInfo{}, errors.New("fitMode must be contain, cover, or stretch")
	}
	if input.Transition != "none" && input.Transition != "fade" {
		return input, assetInfo{}, errors.New("transition must be none or fade")
	}
	if input.DeliveryPolicy != "download" && input.DeliveryPolicy != "stream" && input.DeliveryPolicy != "automatic" {
		return input, assetInfo{}, errors.New("deliveryPolicy must be download, stream, or automatic")
	}
	if *input.Volume < 0 || *input.Volume > 1 {
		return input, assetInfo{}, errors.New("volume must be between 0 and 1")
	}
	var a assetInfo
	err := q.QueryRow(ctx, `SELECT a.type,a.duration_seconds,v.id FROM assets a LEFT JOIN LATERAL(SELECT id FROM asset_variants WHERE asset_id=a.id AND deleted_at IS NULL AND player_compatible=TRUE ORDER BY CASE kind WHEN 'playback' THEN 0 ELSE 1 END LIMIT 1)v ON TRUE WHERE a.id=$1 AND a.deleted_at IS NULL AND a.processing_status='ready' AND (a.type='website' OR v.id IS NOT NULL)`, input.AssetID).Scan(&a.Type, &a.Duration, &a.Variant)
	if errors.Is(err, pgx.ErrNoRows) {
		return input, a, ErrInvalidAsset
	}
	if err != nil {
		return input, a, err
	}
	if a.Type == "image" && (input.DurationMS == nil || *input.DurationMS <= 0) {
		return input, a, errors.New("image durationMs must be positive")
	}
	if a.Type == "website" {
		if input.DurationMS == nil || *input.DurationMS <= 0 {
			return input, a, errors.New("website durationMs must be positive")
		}
		input.DeliveryPolicy = "stream"
		input.VideoStartOffsetMS = nil
		input.VideoEndOffsetMS = nil
		off := false
		input.AudioEnabled = &off
		zero := 0.0
		input.Volume = &zero
	}
	if a.Type == "video" {
		durationMS := int64(0)
		if a.Duration != nil {
			durationMS = int64(*a.Duration * 1000)
		}
		start := int64(0)
		if input.VideoStartOffsetMS != nil {
			start = *input.VideoStartOffsetMS
		}
		if start < 0 || (durationMS > 0 && start >= durationMS) {
			return input, a, errors.New("video start offset is outside the asset duration")
		}
		if input.VideoEndOffsetMS != nil {
			if *input.VideoEndOffsetMS <= start || (durationMS > 0 && *input.VideoEndOffsetMS > durationMS) {
				return input, a, errors.New("video end offset must be after the start and within the asset duration")
			}
		}
	}
	return input, a, nil
}

func (s *Service) AddItem(ctx context.Context, playlistID, userID uuid.UUID, input ItemInput) (Playlist, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	input, _, err = s.validateItem(ctx, tx, input)
	if err != nil {
		return Playlist{}, err
	}
	var position int
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(position)+1,0) FROM playlist_items WHERE playlist_id=$1`, playlistID).Scan(&position); err != nil {
		return Playlist{}, err
	}
	tag, err := tx.Exec(ctx, `UPDATE playlists SET revision=revision+1,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, playlistID)
	if err != nil {
		return Playlist{}, err
	}
	if tag.RowsAffected() == 0 {
		return Playlist{}, ErrNotFound
	}
	_, err = tx.Exec(ctx, `INSERT INTO playlist_items(id,playlist_id,asset_id,position,duration_ms,fit_mode,transition,audio_enabled,volume,video_start_offset_ms,video_end_offset_ms,delivery_policy)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, uuid.New(), playlistID, input.AssetID, position, input.DurationMS, input.FitMode, input.Transition, *input.AudioEnabled, *input.Volume, input.VideoStartOffsetMS, input.VideoEndOffsetMS, input.DeliveryPolicy)
	if err != nil {
		return Playlist{}, err
	}
	notifications, err := bumpAssigned(ctx, tx, playlistID, "playlist.item_added")
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.item_added", playlistID); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	s.notify(notifications)
	return s.Get(ctx, playlistID)
}

func (s *Service) UpdateItem(ctx context.Context, playlistID, itemID, userID uuid.UUID, input ItemInput) (Playlist, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	input, _, err = s.validateItem(ctx, tx, input)
	if err != nil {
		return Playlist{}, err
	}
	tag, err := tx.Exec(ctx, `UPDATE playlist_items SET asset_id=$3,duration_ms=$4,fit_mode=$5,transition=$6,audio_enabled=$7,volume=$8,video_start_offset_ms=$9,video_end_offset_ms=$10,delivery_policy=$11,updated_at=now() WHERE playlist_id=$1 AND id=$2`, playlistID, itemID, input.AssetID, input.DurationMS, input.FitMode, input.Transition, *input.AudioEnabled, *input.Volume, input.VideoStartOffsetMS, input.VideoEndOffsetMS, input.DeliveryPolicy)
	if err != nil {
		return Playlist{}, err
	}
	if tag.RowsAffected() == 0 {
		return Playlist{}, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `UPDATE playlists SET revision=revision+1,updated_at=now() WHERE id=$1`, playlistID); err != nil {
		return Playlist{}, err
	}
	notifications, err := bumpAssigned(ctx, tx, playlistID, "playlist.item_updated")
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.item_updated", playlistID); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	s.notify(notifications)
	return s.Get(ctx, playlistID)
}

func (s *Service) DeleteItem(ctx context.Context, playlistID, itemID, userID uuid.UUID) (Playlist, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `DELETE FROM playlist_items WHERE playlist_id=$1 AND id=$2`, playlistID, itemID)
	if err != nil {
		return Playlist{}, err
	}
	if tag.RowsAffected() == 0 {
		return Playlist{}, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `UPDATE playlist_items SET position=position+1000000 WHERE playlist_id=$1`, playlistID); err != nil {
		return Playlist{}, err
	}
	if _, err = tx.Exec(ctx, `WITH ranked AS(SELECT id,row_number()OVER(ORDER BY position)-1 p FROM playlist_items WHERE playlist_id=$1)UPDATE playlist_items i SET position=r.p FROM ranked r WHERE i.id=r.id`, playlistID); err != nil {
		return Playlist{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE playlists SET revision=revision+1,updated_at=now() WHERE id=$1`, playlistID); err != nil {
		return Playlist{}, err
	}
	notifications, err := bumpAssigned(ctx, tx, playlistID, "playlist.item_deleted")
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.item_deleted", playlistID); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	s.notify(notifications)
	return s.Get(ctx, playlistID)
}

func (s *Service) Reorder(ctx context.Context, playlistID, userID uuid.UUID, ids []uuid.UUID) (Playlist, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Playlist{}, err
	}
	defer tx.Rollback(ctx)
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM playlist_items WHERE playlist_id=$1`, playlistID).Scan(&count); err != nil {
		return Playlist{}, err
	}
	if len(ids) != count {
		return Playlist{}, errors.New("item order must contain every playlist item exactly once")
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if seen[id] {
			return Playlist{}, errors.New("item order contains a duplicate")
		}
		seen[id] = true
	}
	if _, err = tx.Exec(ctx, `UPDATE playlist_items SET position=position+1000000 WHERE playlist_id=$1`, playlistID); err != nil {
		return Playlist{}, err
	}
	for position, id := range ids {
		tag, e := tx.Exec(ctx, `UPDATE playlist_items SET position=$3,updated_at=now() WHERE playlist_id=$1 AND id=$2`, playlistID, id, position)
		if e != nil {
			return Playlist{}, e
		}
		if tag.RowsAffected() != 1 {
			return Playlist{}, errors.New("item order contains an unknown item")
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE playlists SET revision=revision+1,updated_at=now() WHERE id=$1`, playlistID); err != nil {
		return Playlist{}, err
	}
	notifications, err := bumpAssigned(ctx, tx, playlistID, "playlist.reordered")
	if err != nil {
		return Playlist{}, err
	}
	if err = insertAudit(ctx, tx, userID, "playlist.reordered", playlistID); err != nil {
		return Playlist{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Playlist{}, err
	}
	s.notify(notifications)
	return s.Get(ctx, playlistID)
}

type notification struct {
	screen  uuid.UUID
	version int64
}

func bumpAssigned(ctx context.Context, tx pgx.Tx, playlistID uuid.UUID, reason string) ([]notification, error) {
	rows, err := tx.Query(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,previous_manifest_version,changed_at,change_reason) SELECT DISTINCT affected.screen_id,1,NULL::bigint,now(),$2 FROM (SELECT screen_id FROM screen_playlist_assignments WHERE playlist_id=$1 UNION SELECT t.screen_id FROM schedules s JOIN schedule_targets t ON t.schedule_id=s.id WHERE s.playlist_id=$1 AND s.deleted_at IS NULL AND t.screen_id IS NOT NULL UNION SELECT m.screen_id FROM schedules s JOIN schedule_targets t ON t.schedule_id=s.id JOIN screen_group_memberships m ON m.screen_group_id=t.screen_group_id WHERE s.playlist_id=$1 AND s.deleted_at IS NULL) affected ON CONFLICT(screen_id)DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason=$2 RETURNING screen_id,manifest_version`, playlistID, reason)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []notification{}
	for rows.Next() {
		var n notification
		if err := rows.Scan(&n.screen, &n.version); err != nil {
			return nil, err
		}
		result = append(result, n)
	}
	return result, rows.Err()
}
func (s *Service) notify(items []notification) {
	if s.notifier == nil {
		return
	}
	for _, n := range items {
		s.notifier.ManifestChanged(n.screen, n.version)
	}
}

func (s *Service) Assign(ctx context.Context, screenID, playlistID, userID uuid.UUID) (Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM playlists WHERE id=$1 AND deleted_at IS NULL)`, playlistID).Scan(&exists); err != nil {
		return Assignment{}, err
	}
	if !exists {
		return Assignment{}, ErrNotFound
	}
	_, err = tx.Exec(ctx, `INSERT INTO screen_playlist_assignments(id,screen_id,playlist_id,assigned_by)VALUES($1,$2,$3,$4) ON CONFLICT(screen_id)DO UPDATE SET playlist_id=EXCLUDED.playlist_id,assigned_by=EXCLUDED.assigned_by,updated_at=now()`, uuid.New(), screenID, playlistID, userID)
	if err != nil {
		return Assignment{}, err
	}
	var version int64
	err = tx.QueryRow(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason)VALUES($1,1,'assignment.changed') ON CONFLICT(screen_id)DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason='assignment.changed' RETURNING manifest_version`, screenID).Scan(&version)
	if err != nil {
		return Assignment{}, err
	}
	if err = insertAudit(ctx, tx, userID, "screen.playlist_assigned", screenID); err != nil {
		return Assignment{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Assignment{}, err
	}
	if s.notifier != nil {
		s.notifier.ManifestChanged(screenID, version)
	}
	return s.Assignment(ctx, screenID)
}
func (s *Service) Unassign(ctx context.Context, screenID, userID uuid.UUID) (Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `DELETE FROM screen_playlist_assignments WHERE screen_id=$1`, screenID)
	if err != nil {
		return Assignment{}, err
	}
	var version int64
	err = tx.QueryRow(ctx, `INSERT INTO screen_manifest_state(screen_id,manifest_version,change_reason)VALUES($1,1,'assignment.removed') ON CONFLICT(screen_id)DO UPDATE SET previous_manifest_version=screen_manifest_state.manifest_version,manifest_version=screen_manifest_state.manifest_version+1,changed_at=now(),change_reason='assignment.removed' RETURNING manifest_version`, screenID).Scan(&version)
	if err != nil {
		return Assignment{}, err
	}
	if err = insertAudit(ctx, tx, userID, "screen.playlist_unassigned", screenID); err != nil {
		return Assignment{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Assignment{}, err
	}
	if s.notifier != nil {
		s.notifier.ManifestChanged(screenID, version)
	}
	return s.Assignment(ctx, screenID)
}

func (s *Service) Assignment(ctx context.Context, screenID uuid.UUID) (Assignment, error) {
	_, err := s.db.Exec(ctx, `INSERT INTO screen_manifest_state(screen_id)VALUES($1) ON CONFLICT DO NOTHING`, screenID)
	if err != nil {
		return Assignment{}, err
	}
	var a Assignment
	a.ScreenID = screenID
	err = s.db.QueryRow(ctx, `SELECT pa.playlist_id,p.name,p.revision,ms.manifest_version,ps.active_manifest_version,ps.pending_manifest_version,ps.download_queue_count,ps.downloaded_bytes,ps.required_bytes,ps.cache_used_bytes,ps.cache_limit_bytes,ps.current_item_id,ps.current_asset_id,ps.playback_state,ps.last_sync_error,ps.last_playback_error,ps.current_schedule_id,ps.current_playlist_id,ps.selection_source,ps.next_transition_at,ps.device_clock_offset_seconds,ps.schedule_evaluation_error,ps.schedule_manifest_version,ps.current_website_asset_id,ps.website_state,ps.website_load_started_at,ps.website_load_completed_at,ps.website_failure_category,ps.website_blocked_navigation_count,ps.website_current_host,ps.website_fallback_shown,ps.website_renderer_recovery_count FROM screen_manifest_state ms LEFT JOIN screen_playlist_assignments pa ON pa.screen_id=ms.screen_id LEFT JOIN playlists p ON p.id=pa.playlist_id LEFT JOIN screen_player_status ps ON ps.screen_id=ms.screen_id WHERE ms.screen_id=$1`, screenID).Scan(&a.PlaylistID, &a.PlaylistName, &a.PlaylistRevision, &a.ManifestVersion, &a.PlayerActiveManifestVersion, &a.PlayerPendingManifestVersion, &a.DownloadQueueCount, &a.DownloadedBytes, &a.RequiredBytes, &a.CacheUsedBytes, &a.CacheLimitBytes, &a.CurrentItemID, &a.CurrentAssetID, &a.PlaybackState, &a.LastSyncError, &a.LastPlaybackError, &a.CurrentScheduleID, &a.CurrentPlaylistID, &a.SelectionSource, &a.NextTransitionAt, &a.DeviceClockOffsetSeconds, &a.ScheduleEvaluationError, &a.ScheduleManifestVersion, &a.CurrentWebsiteAssetID, &a.WebsiteState, &a.WebsiteLoadStartedAt, &a.WebsiteLoadCompletedAt, &a.WebsiteFailureCategory, &a.WebsiteBlockedNavigationCount, &a.WebsiteCurrentHost, &a.WebsiteFallbackShown, &a.WebsiteRendererRecoveryCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return Assignment{}, ErrNotFound
	}
	if err != nil {
		return Assignment{}, err
	}
	a.Groups = []AssignmentGroup{}
	groupRows, e := s.db.Query(ctx, `SELECT g.id,g.name FROM screen_group_memberships m JOIN screen_groups g ON g.id=m.screen_group_id WHERE m.screen_id=$1 AND g.deleted_at IS NULL ORDER BY lower(g.name),g.id`, screenID)
	if e != nil {
		return Assignment{}, e
	}
	for groupRows.Next() {
		var g AssignmentGroup
		if e = groupRows.Scan(&g.ID, &g.Name); e != nil {
			groupRows.Close()
			return Assignment{}, e
		}
		a.Groups = append(a.Groups, g)
	}
	groupRows.Close()
	a.RelevantSchedules = []AssignmentSchedule{}
	a.ClockSkewWarningSeconds = 300
	if s.scheduling != nil {
		_, _, a.ClockSkewWarningSeconds = s.scheduling.Config()
	}
	scheduleRows, e := s.db.Query(ctx, `SELECT DISTINCT s.id,s.name,p.name,s.priority,s.enabled FROM schedules s JOIN playlists p ON p.id=s.playlist_id JOIN schedule_targets t ON t.schedule_id=s.id LEFT JOIN screen_group_memberships m ON m.screen_group_id=t.screen_group_id AND m.screen_id=$1 WHERE s.deleted_at IS NULL AND (t.screen_id=$1 OR m.screen_id=$1) ORDER BY s.priority DESC,s.id`, screenID)
	if e != nil {
		return Assignment{}, e
	}
	for scheduleRows.Next() {
		var x AssignmentSchedule
		if e = scheduleRows.Scan(&x.ID, &x.Name, &x.PlaylistName, &x.Priority, &x.Enabled); e != nil {
			scheduleRows.Close()
			return Assignment{}, e
		}
		a.RelevantSchedules = append(a.RelevantSchedules, x)
	}
	scheduleRows.Close()
	a.SynchronizationStatus = "not_reported"
	if a.PlayerActiveManifestVersion != nil {
		if *a.PlayerActiveManifestVersion == a.ManifestVersion {
			a.SynchronizationStatus = "current"
		} else if a.PlayerPendingManifestVersion != nil && *a.PlayerPendingManifestVersion == a.ManifestVersion {
			a.SynchronizationStatus = "preparing"
		} else {
			a.SynchronizationStatus = "out_of_date"
		}
	}
	return a, nil
}

func (s *Service) BuildManifest(ctx context.Context, screenID uuid.UUID) (Manifest, string, error) {
	assignment, err := s.Assignment(ctx, screenID)
	if err != nil {
		return Manifest{}, "", err
	}
	var changed time.Time
	if err = s.db.QueryRow(ctx, `UPDATE screen_manifest_state SET last_requested_at=now() WHERE screen_id=$1 RETURNING changed_at`, screenID).Scan(&changed); err != nil {
		return Manifest{}, "", err
	}
	now := time.Now().UTC()
	prefetch, grace := 14, 30
	if s.scheduling != nil {
		prefetch, grace, _ = s.scheduling.Config()
	}
	manifest := Manifest{SchemaVersion: 3, ManifestVersion: assignment.ManifestVersion, ScreenID: screenID, GeneratedAt: changed, ServerTime: now, Mode: "single-zone", Assets: []ManifestAsset{}, Playlists: []ManifestPlaylist{}, Schedules: []ManifestSchedule{}, Websites: []ManifestWebsite{}, PrefetchHorizonDays: prefetch, ActivationGraceSeconds: grace}
	playlistIDs := []uuid.UUID{}
	if assignment.PlaylistID != nil {
		playlistIDs = append(playlistIDs, *assignment.PlaylistID)
	}
	if s.scheduling != nil {
		records, loadErr := s.scheduling.Relevant(ctx, screenID)
		if loadErr != nil {
			return Manifest{}, "", loadErr
		}
		horizon := now.AddDate(0, 0, prefetch)
		for _, record := range records {
			if record.Type == scheduling.OneTime {
				if record.OneTimeEnd != nil && !record.OneTimeEnd.After(now) {
					continue
				}
				if record.OneTimeStart != nil && record.OneTimeStart.After(horizon) {
					continue
				}
			}
			manifest.Schedules = append(manifest.Schedules, ManifestSchedule{ID: record.ID, PlaylistID: record.PlaylistID, Type: string(record.Type), Timezone: record.Timezone, Priority: record.Priority, Specificity: record.Specificity, StartDate: record.StartDate, EndDate: record.EndDate, OneTimeStart: record.OneTimeStart, OneTimeEnd: record.OneTimeEnd, DailyStart: record.DailyStart, DailyEnd: record.DailyEnd, DaysOfWeek: record.DaysOfWeek})
			playlistIDs = append(playlistIDs, record.PlaylistID)
		}
	}
	seen := map[uuid.UUID]bool{}
	seenPlaylists := map[uuid.UUID]bool{}
	for _, playlistID := range playlistIDs {
		if seenPlaylists[playlistID] {
			continue
		}
		seenPlaylists[playlistID] = true
		playlist, loadErr := s.Get(ctx, playlistID)
		if loadErr != nil {
			return Manifest{}, "", loadErr
		}
		mp := ManifestPlaylist{ID: playlist.ID, Revision: playlist.Revision, Name: playlist.Name, Items: []ManifestItem{}}
		for _, item := range playlist.Items {
			if item.AssetStatus != "ready" || (item.AssetType != "website" && item.VariantID == nil) {
				return Manifest{}, "", fmt.Errorf("%w: playlist contains an unavailable asset", ErrConflict)
			}
			if item.AssetType == "website" {
				var website ManifestWebsite
				website.AssetID = item.AssetID
				website.Name = item.AssetName
				err = s.db.QueryRow(ctx, `SELECT url,allowed_hosts,javascript_enabled,dom_storage_enabled,cookie_policy,reload_policy,refresh_interval_seconds,load_timeout_seconds,zoom_percent,scroll_x,scroll_y,custom_user_agent,background_color,failure_behavior,fallback_image_asset_id FROM website_assets WHERE asset_id=$1`, item.AssetID).Scan(&website.URL, &website.AllowedHosts, &website.JavaScriptEnabled, &website.DOMStorageEnabled, &website.CookiePolicy, &website.ReloadPolicy, &website.RefreshIntervalSeconds, &website.LoadTimeoutSeconds, &website.ZoomPercent, &website.ScrollX, &website.ScrollY, &website.CustomUserAgent, &website.BackgroundColor, &website.FailureBehavior, &website.FallbackImageAssetID)
				if err != nil {
					return Manifest{}, "", err
				}
				if website.FallbackImageAssetID != nil {
					var fallback ManifestAsset
					err = s.db.QueryRow(ctx, `SELECT v.asset_id,v.id,v.mime_type,encode(v.sha256,'hex'),v.file_size,v.width,v.height,v.duration_seconds FROM asset_variants v WHERE v.asset_id=$1 AND v.deleted_at IS NULL AND v.player_compatible=TRUE ORDER BY CASE kind WHEN 'playback' THEN 0 WHEN 'original' THEN 1 ELSE 2 END LIMIT 1`, *website.FallbackImageAssetID).Scan(&fallback.AssetID, &fallback.VariantID, &fallback.MIMEType, &fallback.SHA256, &fallback.FileSize, &fallback.Width, &fallback.Height, &fallback.DurationSeconds)
					if err != nil {
						return Manifest{}, "", fmt.Errorf("%w: website fallback image unavailable", ErrConflict)
					}
					fallback.DownloadPath = "/api/v1/player/assets/" + fallback.AssetID.String() + "/variants/" + fallback.VariantID.String()
					website.FallbackVariantID = &fallback.VariantID
					if !seen[fallback.VariantID] {
						manifest.Assets = append(manifest.Assets, fallback)
						seen[fallback.VariantID] = true
					}
				}
				found := false
				for _, existing := range manifest.Websites {
					if existing.AssetID == website.AssetID {
						found = true
					}
				}
				if !found {
					manifest.Websites = append(manifest.Websites, website)
				}
				mp.Items = append(mp.Items, ManifestItem{ID: item.ID, AssetID: item.AssetID, AssetType: "website", DurationMS: item.DurationMS, FitMode: item.FitMode, Transition: item.Transition, AudioEnabled: false, Volume: 0, DeliveryPolicy: "stream"})
				continue
			}
			var asset ManifestAsset
			err = s.db.QueryRow(ctx, `SELECT v.asset_id,v.id,v.mime_type,encode(v.sha256,'hex'),v.file_size,v.width,v.height,v.duration_seconds FROM asset_variants v WHERE v.id=$1 AND v.deleted_at IS NULL AND v.player_compatible=TRUE`, *item.VariantID).Scan(&asset.AssetID, &asset.VariantID, &asset.MIMEType, &asset.SHA256, &asset.FileSize, &asset.Width, &asset.Height, &asset.DurationSeconds)
			if err != nil {
				return Manifest{}, "", err
			}
			asset.DownloadPath = "/api/v1/player/assets/" + asset.AssetID.String() + "/variants/" + asset.VariantID.String()
			mp.Items = append(mp.Items, ManifestItem{ID: item.ID, AssetID: item.AssetID, AssetType: item.AssetType, VariantID: item.VariantID, DurationMS: item.DurationMS, FitMode: item.FitMode, Transition: item.Transition, AudioEnabled: item.AudioEnabled, Volume: item.Volume, VideoStartOffsetMS: item.VideoStartOffsetMS, VideoEndOffsetMS: item.VideoEndOffsetMS, DeliveryPolicy: item.DeliveryPolicy})
			if !seen[asset.VariantID] {
				manifest.Assets = append(manifest.Assets, asset)
				seen[asset.VariantID] = true
			}
		}
		manifest.Playlists = append(manifest.Playlists, mp)
		if assignment.PlaylistID != nil && playlistID == *assignment.PlaylistID {
			fallback := mp
			manifest.DirectFallbackPlaylist = &fallback
		}
	}
	encoded, encodeErr := json.Marshal(manifest)
	if encodeErr != nil {
		return Manifest{}, "", encodeErr
	}
	if len(encoded) > 5*1024*1024 {
		return Manifest{}, "", fmt.Errorf("%w: manifest exceeds the five MiB limit", ErrConflict)
	}
	return manifest, manifestETag(screenID, assignment.ManifestVersion), nil
}

func (s *Service) AssetChanged(ctx context.Context, assetID uuid.UUID, reason string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT DISTINCT playlist_id FROM playlist_items WHERE asset_id=$1`, assetID)
	if err != nil {
		return err
	}
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	notes := []notification{}
	for _, id := range ids {
		changed, e := bumpAssigned(ctx, tx, id, reason)
		if e != nil {
			return e
		}
		notes = append(notes, changed...)
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(notes)
	return nil
}
func manifestETag(screenID uuid.UUID, version int64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", screenID, version)))
	return `"manifest-` + hex.EncodeToString(sum[:]) + `"`
}

func (s *Service) ReportStatus(ctx context.Context, screenID uuid.UUID, status PlayerStatus) error {
	if len(status.PlaybackState) > 80 || len(status.LastSyncError) > 500 || len(status.LastPlaybackError) > 500 || len(status.ScheduleEvaluationError) > 500 || len(status.WebsiteState) > 40 || len(status.WebsiteFailureCategory) > 80 || len(status.WebsiteCurrentHost) > 253 {
		return errors.New("player status is invalid")
	}
	if status.SelectionSource != "" && status.SelectionSource != "schedule" && status.SelectionSource != "direct_fallback" && status.SelectionSource != "none" {
		return errors.New("player status is invalid")
	}
	websiteStates := map[string]bool{"": true, "idle": true, "loading": true, "loaded": true, "refreshing": true, "failed": true, "timed_out": true, "blocked": true, "showing_fallback": true}
	websiteErrors := map[string]bool{"": true, "dns_failure": true, "connection_failure": true, "tls_failure": true, "http_error": true, "load_timeout": true, "blocked_navigation": true, "renderer_crash": true, "offline": true, "invalid_configuration": true, "unsupported_scheme": true, "unknown_webview_error": true}
	if !websiteStates[status.WebsiteState] || !websiteErrors[status.WebsiteFailureCategory] {
		return errors.New("player website status is invalid")
	}
	if status.DeviceClockOffsetSeconds != nil && (*status.DeviceClockOffsetSeconds < -604800 || *status.DeviceClockOffsetSeconds > 604800) {
		return errors.New("player status is invalid")
	}
	for _, value := range []*int64{status.DownloadedBytes, status.RequiredBytes, status.CacheUsedBytes, status.CacheLimitBytes} {
		if value != nil && *value < 0 {
			return errors.New("player status is invalid")
		}
	}
	if status.DownloadQueueCount != nil && *status.DownloadQueueCount < 0 {
		return errors.New("player status is invalid")
	}
	for _, value := range []*int{status.WebsiteBlockedNavigationCount, status.WebsiteRendererRecoveryCount} {
		if value != nil && (*value < 0 || *value > 1000000) {
			return errors.New("player website status is invalid")
		}
	}
	_, err := s.db.Exec(ctx, `INSERT INTO screen_player_status(screen_id,active_manifest_version,pending_manifest_version,assigned_playlist_id,current_item_id,current_asset_id,playback_state,download_queue_count,downloaded_bytes,required_bytes,cache_used_bytes,cache_limit_bytes,last_sync_error,last_playback_error,current_schedule_id,current_playlist_id,selection_source,next_transition_at,device_clock_offset_seconds,schedule_evaluation_error,schedule_manifest_version,current_website_asset_id,website_state,website_load_started_at,website_load_completed_at,website_failure_category,website_blocked_navigation_count,website_current_host,website_fallback_shown,website_renderer_recovery_count,updated_at)VALUES($1,$2,$3,$4,$5,$6,NULLIF($7,''),$8,$9,$10,$11,$12,NULLIF($13,''),NULLIF($14,''),$15,$16,NULLIF($17,''),$18,$19,NULLIF($20,''),$21,$22,NULLIF($23,''),$24,$25,NULLIF($26,''),$27,NULLIF($28,''),$29,$30,now()) ON CONFLICT(screen_id)DO UPDATE SET active_manifest_version=EXCLUDED.active_manifest_version,pending_manifest_version=EXCLUDED.pending_manifest_version,assigned_playlist_id=EXCLUDED.assigned_playlist_id,current_item_id=EXCLUDED.current_item_id,current_asset_id=EXCLUDED.current_asset_id,playback_state=EXCLUDED.playback_state,download_queue_count=EXCLUDED.download_queue_count,downloaded_bytes=EXCLUDED.downloaded_bytes,required_bytes=EXCLUDED.required_bytes,cache_used_bytes=EXCLUDED.cache_used_bytes,cache_limit_bytes=EXCLUDED.cache_limit_bytes,last_sync_error=EXCLUDED.last_sync_error,last_playback_error=EXCLUDED.last_playback_error,current_schedule_id=EXCLUDED.current_schedule_id,current_playlist_id=EXCLUDED.current_playlist_id,selection_source=EXCLUDED.selection_source,next_transition_at=EXCLUDED.next_transition_at,device_clock_offset_seconds=EXCLUDED.device_clock_offset_seconds,schedule_evaluation_error=EXCLUDED.schedule_evaluation_error,schedule_manifest_version=EXCLUDED.schedule_manifest_version,current_website_asset_id=EXCLUDED.current_website_asset_id,website_state=EXCLUDED.website_state,website_load_started_at=COALESCE(EXCLUDED.website_load_started_at,screen_player_status.website_load_started_at),website_load_completed_at=COALESCE(EXCLUDED.website_load_completed_at,screen_player_status.website_load_completed_at),website_failure_category=COALESCE(EXCLUDED.website_failure_category,screen_player_status.website_failure_category),website_blocked_navigation_count=EXCLUDED.website_blocked_navigation_count,website_current_host=COALESCE(EXCLUDED.website_current_host,screen_player_status.website_current_host),website_fallback_shown=EXCLUDED.website_fallback_shown,website_renderer_recovery_count=EXCLUDED.website_renderer_recovery_count,updated_at=now()`, screenID, status.ActiveManifestVersion, status.PendingManifestVersion, status.AssignedPlaylistID, status.CurrentItemID, status.CurrentAssetID, status.PlaybackState, status.DownloadQueueCount, status.DownloadedBytes, status.RequiredBytes, status.CacheUsedBytes, status.CacheLimitBytes, status.LastSyncError, status.LastPlaybackError, status.CurrentScheduleID, status.CurrentPlaylistID, status.SelectionSource, status.NextTransitionAt, status.DeviceClockOffsetSeconds, status.ScheduleEvaluationError, status.ScheduleManifestVersion, status.CurrentWebsiteAssetID, status.WebsiteState, status.WebsiteLoadStartedAt, status.WebsiteLoadCompletedAt, status.WebsiteFailureCategory, status.WebsiteBlockedNavigationCount, status.WebsiteCurrentHost, status.WebsiteFallbackShown, status.WebsiteRendererRecoveryCount)
	if err == nil && status.CurrentWebsiteAssetID != nil {
		_, err = s.db.Exec(ctx, `UPDATE screen_player_status SET last_website_asset_id=$2 WHERE screen_id=$1`, screenID, status.CurrentWebsiteAssetID)
	}
	if err == nil && status.WebsiteFailureCategory != "" {
		_, err = s.db.Exec(ctx, `UPDATE screen_player_status SET website_failure_at=now() WHERE screen_id=$1`, screenID)
	}
	return err
}

func insertAudit(ctx context.Context, tx pgx.Tx, userID uuid.UUID, action string, id uuid.UUID) error {
	resource := "playlist"
	if strings.HasPrefix(action, "screen.") {
		resource = "screen"
	}
	_, err := tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,$3,$4,$5)`, uuid.New(), userID, action, resource, id.String())
	return err
}
