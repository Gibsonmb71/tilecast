package playlists

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Playlist revision history. Layouts have had this since layout_revisions;
// playlists are the thing most likely to be edited in a hurry while sitting on
// every screen, and until now the audit log could say a playlist changed but
// could not put it back.
//
// A revision is a whole snapshot rather than a diff. A diff has to be replayed,
// and a replay that hits a deleted asset half way through leaves the playlist in
// a state nobody authored. A snapshot restores or fails.

// RevisionsToKeep bounds the history per playlist. Deep history on a playlist
// that is edited daily is cost without a reader; what people reach for is the
// last few states.
const RevisionsToKeep = 30

// snapshotRevision records the playlist as it now stands, inside the caller's
// transaction.
//
// It must be called after the revision bump and after the item writes, so it
// captures the state the edit produced. Recording the same revision twice is
// harmless: the unique constraint makes it a no-op, which is what lets this be
// called from several sites and backfilled lazily without producing duplicates.
func snapshotRevision(ctx context.Context, tx pgx.Tx, playlistID uuid.UUID, user *uuid.UUID) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO playlist_revisions(
			id,playlist_id,revision,name,description,source_type,tag_match,
			tag_image_duration_ms,items,tag_ids,created_by)
		SELECT gen_random_uuid(), p.id, p.revision, p.name, p.description,
		       p.source_type, p.tag_match, p.tag_image_duration_ms,
		       COALESCE((
		           SELECT jsonb_agg(item ORDER BY (item->>'position')::int)
		           FROM (
		               SELECT jsonb_build_object(
		                   'assetId', i.asset_id, 'layoutId', i.layout_id,
		                   'position', i.position, 'durationMs', i.duration_ms,
		                   'fitMode', i.fit_mode, 'transition', i.transition,
		                   'audioEnabled', i.audio_enabled, 'volume', i.volume,
		                   'usePlayerDefaults', i.use_player_defaults,
		                   'videoStartOffsetMs', i.video_start_offset_ms,
		                   'videoEndOffsetMs', i.video_end_offset_ms,
		                   'deliveryPolicy', i.delivery_policy) AS item
		               FROM playlist_items i WHERE i.playlist_id=p.id
		           ) items
		       ), '[]'::jsonb),
		       COALESCE((
		           SELECT jsonb_agg(t.tag_id) FROM playlist_tags t WHERE t.playlist_id=p.id
		       ), '[]'::jsonb),
		       $2
		FROM playlists p WHERE p.id=$1
		ON CONFLICT (playlist_id, revision) DO NOTHING`, playlistID, user)
	if err != nil {
		return fmt.Errorf("snapshot playlist revision: %w", err)
	}
	// Trim inside the same transaction so the cap cannot be exceeded even
	// briefly.
	_, err = tx.Exec(ctx, `
		DELETE FROM playlist_revisions WHERE id IN (
			SELECT id FROM playlist_revisions WHERE playlist_id=$1
			ORDER BY revision DESC OFFSET $2)`, playlistID, RevisionsToKeep)
	return err
}

// RevisionSummary is one entry in the history.
type RevisionSummary struct {
	Revision    int64      `json:"revision"`
	Name        string     `json:"name"`
	ItemCount   int        `json:"itemCount"`
	SourceType  string     `json:"sourceType"`
	CreatedAt   time.Time  `json:"createdAt"`
	CreatedBy   *uuid.UUID `json:"createdBy,omitempty"`
	AuthorName  string     `json:"authorName,omitempty"`
	IsCurrent   bool       `json:"isCurrent"`
	Restorable  bool       `json:"restorable"`
	MissingRefs int        `json:"missingReferences"`
}

// ListRevisions returns the history for a playlist, newest first.
//
// It backfills a snapshot for the current revision if one is missing, so a
// playlist edited before this feature shipped, or through a path that did not
// record, still has a recoverable present state.
func (s *Service) ListRevisions(ctx context.Context, playlistID uuid.UUID) ([]RevisionSummary, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM playlists WHERE id=$1 AND deleted_at IS NULL)`,
		playlistID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	if err := snapshotRevision(ctx, tx, playlistID, nil); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	rows, err := s.db.Query(ctx, `
		SELECT r.revision, r.name, jsonb_array_length(r.items), r.source_type,
		       r.created_at, r.created_by, COALESCE(u.name,''),
		       r.revision = p.revision,
		       (SELECT count(*) FROM jsonb_array_elements(r.items) item
		        -- The same predicates the restore applies, or a revision could be
		        -- offered as restorable and then come back with fewer items.
		        WHERE (item->>'assetId' IS NOT NULL
		               AND NOT EXISTS(SELECT 1 FROM assets a
		                              WHERE a.id=(item->>'assetId')::uuid
		                                AND a.deleted_at IS NULL
		                                AND a.processing_status='ready'))
		           OR (item->>'layoutId' IS NOT NULL
		               AND NOT EXISTS(SELECT 1 FROM layouts l
		                              WHERE l.id=(item->>'layoutId')::uuid
		                                AND l.deleted_at IS NULL
		                                AND l.published_revision_id IS NOT NULL)))
		FROM playlist_revisions r
		JOIN playlists p ON p.id=r.playlist_id
		LEFT JOIN users u ON u.id=r.created_by
		WHERE r.playlist_id=$1
		ORDER BY r.revision DESC`, playlistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RevisionSummary{}
	for rows.Next() {
		var item RevisionSummary
		if err := rows.Scan(&item.Revision, &item.Name, &item.ItemCount, &item.SourceType,
			&item.CreatedAt, &item.CreatedBy, &item.AuthorName, &item.IsCurrent,
			&item.MissingRefs); err != nil {
			return nil, err
		}
		// A revision whose every item has been deleted restores to an empty
		// playlist, which is worse than useless on a screen. Say so up front
		// rather than after the restore.
		item.Restorable = !item.IsCurrent && item.ItemCount > item.MissingRefs
		if item.ItemCount == 0 {
			item.Restorable = !item.IsCurrent
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// RestoreResult reports what a restore did, including what it could not.
type RestoreResult struct {
	Playlist Playlist `json:"playlist"`
	// RestoredFrom is the revision that was restored, and NewRevision is the
	// revision the restore produced. A restore is a new edit, not a rewind of
	// history: the state it replaced stays in the history.
	RestoredFrom int64 `json:"restoredFrom"`
	NewRevision  int64 `json:"newRevision"`
	// SkippedItems counts items whose asset or Layout no longer exists. A
	// restore never resurrects deleted content and never silently drops an item
	// without saying so.
	SkippedItems int `json:"skippedItems"`
}

// RestoreRevision puts a playlist back to an earlier snapshot.
func (s *Service) RestoreRevision(ctx context.Context, playlistID uuid.UUID, revision int64, user uuid.UUID) (RestoreResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return RestoreResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Snapshot the present first, so a restore can itself be undone.
	if err := snapshotRevision(ctx, tx, playlistID, &user); err != nil {
		return RestoreResult{}, err
	}

	var raw []byte
	var name, description, sourceType, tagMatch string
	var tagDuration int64
	var tagIDs []byte
	err = tx.QueryRow(ctx, `
		SELECT items,name,description,source_type,tag_match,tag_image_duration_ms,tag_ids
		FROM playlist_revisions WHERE playlist_id=$1 AND revision=$2`,
		playlistID, revision).Scan(&raw, &name, &description, &sourceType, &tagMatch, &tagDuration, &tagIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return RestoreResult{}, ErrNotFound
	}
	if err != nil {
		return RestoreResult{}, err
	}

	var items []struct {
		AssetID            *uuid.UUID `json:"assetId"`
		LayoutID           *uuid.UUID `json:"layoutId"`
		Position           int        `json:"position"`
		DurationMS         *int64     `json:"durationMs"`
		FitMode            string     `json:"fitMode"`
		Transition         string     `json:"transition"`
		AudioEnabled       bool       `json:"audioEnabled"`
		Volume             float64    `json:"volume"`
		VideoStartOffsetMS *int64     `json:"videoStartOffsetMs"`
		VideoEndOffsetMS   *int64     `json:"videoEndOffsetMs"`
		DeliveryPolicy     string     `json:"deliveryPolicy"`
		UsePlayerDefaults  bool       `json:"usePlayerDefaults"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return RestoreResult{}, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM playlist_items WHERE playlist_id=$1`, playlistID); err != nil {
		return RestoreResult{}, err
	}
	// Restore in the order the snapshot recorded, not the order the array
	// happens to be in. The aggregate is already ordered numerically; sorting
	// again here means a snapshot written by an older build, or by any future
	// path, still restores in the right order.
	sort.SliceStable(items, func(i, j int) bool { return items[i].Position < items[j].Position })
	skipped, position := 0, 0
	for _, item := range items {
		// Content deleted since the snapshot is skipped, never resurrected.
		var present bool
		switch {
		case item.AssetID != nil:
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM assets WHERE id=$1 AND deleted_at IS NULL AND processing_status='ready')`,
				item.AssetID).Scan(&present); err != nil {
				return RestoreResult{}, err
			}
		case item.LayoutID != nil:
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM layouts WHERE id=$1 AND deleted_at IS NULL AND published_revision_id IS NOT NULL)`,
				item.LayoutID).Scan(&present); err != nil {
				return RestoreResult{}, err
			}
		}
		if !present {
			skipped++
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO playlist_items(
				id,playlist_id,asset_id,layout_id,position,duration_ms,fit_mode,
				transition,audio_enabled,volume,video_start_offset_ms,
				video_end_offset_ms,delivery_policy,use_player_defaults)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
			uuid.New(), playlistID, item.AssetID, item.LayoutID, position, item.DurationMS,
			item.FitMode, item.Transition, item.AudioEnabled, item.Volume,
			item.VideoStartOffsetMS, item.VideoEndOffsetMS, item.DeliveryPolicy, item.UsePlayerDefaults); err != nil {
			return RestoreResult{}, err
		}
		position++
	}

	// A restore is an ordinary edit: it bumps the revision, so the manifest
	// changes, content review re-opens if it is required, and the state it
	// replaced stays in the history.
	var newRevision int64
	if err := tx.QueryRow(ctx, `
		UPDATE playlists SET name=$2,description=$3,source_type=$4,tag_match=$5,
			tag_image_duration_ms=$6,revision=revision+1,updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL RETURNING revision`,
		playlistID, name, description, sourceType, tagMatch, tagDuration).Scan(&newRevision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RestoreResult{}, ErrNotFound
		}
		return RestoreResult{}, err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM playlist_tags WHERE playlist_id=$1`, playlistID); err != nil {
		return RestoreResult{}, err
	}
	var restoredTags []uuid.UUID
	if err := json.Unmarshal(tagIDs, &restoredTags); err != nil {
		// A malformed snapshot must not restore a tag playlist with no tags
		// after its tags have already been deleted.
		return RestoreResult{}, fmt.Errorf("decode restored tags: %w", err)
	}
	for _, tag := range restoredTags {
		// A tag deleted since the snapshot is skipped for the same reason an
		// asset is.
		if _, err := tx.Exec(ctx, `
			INSERT INTO playlist_tags(playlist_id,tag_id)
			SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM content_tags WHERE id=$2)
			ON CONFLICT DO NOTHING`, playlistID, tag); err != nil {
			return RestoreResult{}, err
		}
	}

	if err := snapshotRevision(ctx, tx, playlistID, &user); err != nil {
		return RestoreResult{}, err
	}
	notifications, err := bumpAssigned(ctx, tx, playlistID, "playlist.revision_restored")
	if err != nil {
		return RestoreResult{}, err
	}
	if err := insertAudit(ctx, tx, user, "playlist.revision_restored", playlistID); err != nil {
		return RestoreResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RestoreResult{}, err
	}
	s.notify(notifications)

	playlist, err := s.Get(ctx, playlistID)
	if err != nil {
		return RestoreResult{}, err
	}
	return RestoreResult{
		Playlist: playlist, RestoredFrom: revision,
		NewRevision: newRevision, SkippedItems: skipped,
	}, nil
}
