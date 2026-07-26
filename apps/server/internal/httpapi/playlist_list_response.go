package httpapi

import (
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

type playlistListItemResponse struct {
	playlists.Playlist
	PreviewItems []playlists.ListPreviewItem `json:"previewItems"`
}

type playlistListResponse struct {
	Items    []playlistListItemResponse `json:"items"`
	Total    int                        `json:"total"`
	Page     int                        `json:"page"`
	PageSize int                        `json:"pageSize"`
}

func playlistListWithPreviews(
	result playlists.ListResult,
	previews map[uuid.UUID][]playlists.ListPreviewItem,
) playlistListResponse {
	response := playlistListResponse{
		Items:    make([]playlistListItemResponse, 0, len(result.Items)),
		Total:    result.Total,
		Page:     result.Page,
		PageSize: result.PageSize,
	}
	for _, playlist := range result.Items {
		items := previews[playlist.ID]
		if items == nil {
			items = []playlists.ListPreviewItem{}
		}
		response.Items = append(response.Items, playlistListItemResponse{
			Playlist:     playlist,
			PreviewItems: items,
		})
	}
	return response
}
