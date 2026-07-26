package playlists

import (
	"testing"

	"github.com/google/uuid"
)

func TestListPreviewThumbnailURL(t *testing.T) {
	assetID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	layoutID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	if got := listPreviewThumbnailURL(&assetID, nil, false); got != "/api/v1/assets/11111111-1111-1111-1111-111111111111/thumbnail" {
		t.Fatalf("asset thumbnail URL=%q", got)
	}
	if got := listPreviewThumbnailURL(nil, &layoutID, true); got != "/api/v1/layouts/22222222-2222-2222-2222-222222222222/preview-image" {
		t.Fatalf("layout preview URL=%q", got)
	}
	if got := listPreviewThumbnailURL(nil, &layoutID, false); got != "" {
		t.Fatalf("layout without preview URL=%q", got)
	}
	if got := listPreviewThumbnailURL(nil, nil, false); got != "" {
		t.Fatalf("missing content URL=%q", got)
	}
}
