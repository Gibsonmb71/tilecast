package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

func TestPlaylistListWithPreviews(t *testing.T) {
	playlistID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	previewID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	result := playlists.ListResult{
		Items: []playlists.Playlist{{ID: playlistID, Name: "Morning"}},
		Total: 1,
		Page: 1,
		PageSize: 100,
	}
	response := playlistListWithPreviews(result, map[uuid.UUID][]playlists.ListPreviewItem{
		playlistID: {{ID: previewID, Name: "Welcome", Type: "image"}},
	})

	if response.Total != 1 || response.Page != 1 || response.PageSize != 100 {
		t.Fatalf("response metadata=%#v", response)
	}
	if len(response.Items) != 1 || len(response.Items[0].PreviewItems) != 1 {
		t.Fatalf("response items=%#v", response.Items)
	}
	if response.Items[0].PreviewItems[0].Name != "Welcome" {
		t.Fatalf("preview=%#v", response.Items[0].PreviewItems[0])
	}
}

func TestPlaylistListWithPreviewsUsesEmptyArray(t *testing.T) {
	playlistID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	response := playlistListWithPreviews(playlists.ListResult{
		Items: []playlists.Playlist{{ID: playlistID, Name: "Empty"}},
	}, nil)

	if response.Items[0].PreviewItems == nil {
		t.Fatal("missing previews should serialize as an empty array")
	}
}
