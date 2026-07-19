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

func TestDowngradeManifestCrossfadesPreservesOtherTransitions(t *testing.T) {
	direct := &ManifestPlaylist{Items: []ManifestItem{{Transition: "crossfade"}}}
	manifest := Manifest{Playlist: direct, Playlists: []ManifestPlaylist{{Items: []ManifestItem{
		{Transition: "crossfade"},
		{Transition: "fade"},
		{Transition: "none"},
	}}}}
	if !manifestHasCrossfade(manifest) {
		t.Fatal("crossfade was not detected")
	}
	downgradeManifestCrossfades(&manifest)
	got := manifest.Playlists[0].Items
	if got[0].Transition != "fade" || got[1].Transition != "fade" || got[2].Transition != "none" {
		t.Fatalf("unexpected downgraded transitions: %#v", got)
	}
	if manifest.Playlist.Items[0].Transition != "fade" {
		t.Fatalf("direct playlist was not downgraded: %#v", manifest.Playlist.Items)
	}
}
