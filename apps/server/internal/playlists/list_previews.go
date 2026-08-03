package playlists

import (
	"context"

	"github.com/google/uuid"
)

const playlistListPreviewLimit = 4

// ListPreviewItem is the compact visual metadata returned with playlist list rows. It deliberately
// omits playback configuration; the playlist detail endpoint remains the source of truth for that.
type ListPreviewItem struct {
	ID           uuid.UUID `json:"id"`
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
}

// ListPreviewItems reads up to four representative items for each requested playlist in one query.
// Static playlists preserve timeline order. Tag-driven playlists use the same deterministic name
// ordering and matching rules as the full playlist projection.
func (s *Service) ListPreviewItems(ctx context.Context, playlistIDs []uuid.UUID) (map[uuid.UUID][]ListPreviewItem, error) {
	result := make(map[uuid.UUID][]ListPreviewItem, len(playlistIDs))
	if len(playlistIDs) == 0 {
		return result, nil
	}

	rows, err := s.db.Query(ctx, `
		WITH requested AS (
			SELECT p.id,d.source_type,d.tag_match
			FROM playlists p JOIN playlist_drafts d ON d.playlist_id=p.id
			WHERE p.id=ANY($1::uuid[]) AND p.deleted_at IS NULL
		), ranked_static AS (
			SELECT p.id AS playlist_id,
				i.id AS preview_id,
				COALESCE(a.name,l.name,'Unavailable content') AS asset_name,
				CASE WHEN i.layout_id IS NOT NULL THEN 'layout' ELSE COALESCE(a.type,'image') END AS asset_type,
				a.id AS asset_id,
				l.id AS layout_id,
				COALESCE(l.preview_image IS NOT NULL,FALSE) AS layout_has_preview,
				row_number() OVER(PARTITION BY p.id ORDER BY i.position,i.id) AS preview_rank
			FROM requested p
			JOIN playlist_draft_items i ON i.playlist_id=p.id
			LEFT JOIN assets a ON a.id=i.asset_id AND a.deleted_at IS NULL
			LEFT JOIN layouts l ON l.id=i.layout_id AND l.deleted_at IS NULL
			WHERE p.source_type='static'
		), ranked_tag AS (
			SELECT p.id AS playlist_id,
				a.id AS preview_id,
				a.name AS asset_name,
				a.type AS asset_type,
				a.id AS asset_id,
				NULL::uuid AS layout_id,
				FALSE AS layout_has_preview,
				row_number() OVER(PARTITION BY p.id ORDER BY lower(a.name),a.id) AS preview_rank
			FROM requested p
			JOIN assets a ON a.deleted_at IS NULL
				AND a.archived_at IS NULL
				AND (a.expires_at IS NULL OR a.expires_at>now())
				AND a.origin='library'
				AND a.type IN('image','video')
				AND a.processing_status='ready'
				AND EXISTS(
					SELECT 1 FROM asset_variants v
					WHERE v.asset_id=a.id AND v.deleted_at IS NULL AND v.player_compatible=TRUE
				)
			WHERE p.source_type='tag'
				AND EXISTS(SELECT 1 FROM playlist_draft_tags selected WHERE selected.playlist_id=p.id)
				AND (
					(p.tag_match='any' AND EXISTS(
						SELECT 1
						FROM content_asset_tags at
						JOIN playlist_draft_tags selected ON selected.tag_id=at.tag_id
						WHERE at.asset_id=a.id AND selected.playlist_id=p.id
					))
					OR
					(p.tag_match='all' AND NOT EXISTS(
						SELECT 1
						FROM playlist_draft_tags selected
						WHERE selected.playlist_id=p.id
							AND NOT EXISTS(
								SELECT 1 FROM content_asset_tags at
								WHERE at.asset_id=a.id AND at.tag_id=selected.tag_id
							)
					))
				)
		), previews AS (
			SELECT playlist_id,preview_id,asset_name,asset_type,asset_id,layout_id,layout_has_preview,preview_rank
			FROM ranked_static WHERE preview_rank<=$2
			UNION ALL
			SELECT playlist_id,preview_id,asset_name,asset_type,asset_id,layout_id,layout_has_preview,preview_rank
			FROM ranked_tag WHERE preview_rank<=$2
		)
		SELECT playlist_id,preview_id,asset_name,asset_type,asset_id,layout_id,layout_has_preview,preview_rank
		FROM previews
		ORDER BY playlist_id,preview_rank`, playlistIDs, playlistListPreviewLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var playlistID uuid.UUID
		var item ListPreviewItem
		var assetID, layoutID *uuid.UUID
		var layoutHasPreview bool
		var rank int64
		if err = rows.Scan(
			&playlistID,
			&item.ID,
			&item.Name,
			&item.Type,
			&assetID,
			&layoutID,
			&layoutHasPreview,
			&rank,
		); err != nil {
			return nil, err
		}
		item.ThumbnailURL = listPreviewThumbnailURL(assetID, layoutID, layoutHasPreview)
		result[playlistID] = append(result[playlistID], item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func listPreviewThumbnailURL(assetID, layoutID *uuid.UUID, layoutHasPreview bool) string {
	if assetID != nil {
		return "/api/v1/assets/" + assetID.String() + "/thumbnail"
	}
	if layoutID != nil && layoutHasPreview {
		return "/api/v1/layouts/" + layoutID.String() + "/preview-image"
	}
	return ""
}
