package playlists

import (
	"testing"

	"github.com/google/uuid"
)

func TestManifestETagStableAndVersioned(t *testing.T) {
	screen := uuid.New()
	first := manifestETag(screen, 4)
	if first != manifestETag(screen, 4) {
		t.Fatal("manifest ETag is unstable")
	}
	if first == manifestETag(screen, 5) {
		t.Fatal("manifest ETag ignored the version")
	}
}
