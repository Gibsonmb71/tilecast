package campaigns

import (
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestNormalizeSnapshotCreatesStableAuthoringDefaults(t *testing.T) {
	snapshot := Snapshot{Name: "Morning", Destinations: nil, Blocks: []Block{{ContentType: "playlist", ContentID: uuid.New()}}}
	normalizeSnapshot(&snapshot)

	if snapshot.Timezone != "UTC" {
		t.Fatalf("timezone = %q, want UTC", snapshot.Timezone)
	}
	if snapshot.Destinations == nil || snapshot.Blocks == nil {
		t.Fatal("normalization should allocate empty collections")
	}
	if snapshot.Blocks[0].ID == uuid.Nil || snapshot.Blocks[0].Name != "Block 1" || snapshot.Blocks[0].Timezone != "UTC" {
		t.Fatalf("normalized block = %#v", snapshot.Blocks[0])
	}
}

func TestValidateSnapshotShapeRejectsAmbiguousReferences(t *testing.T) {
	id := uuid.New()
	snapshot := Snapshot{
		Name:         "Morning",
		Timezone:     "UTC",
		Destinations: []Destination{{Type: "screen", ID: id}, {Type: "screen", ID: id}},
		Blocks:       []Block{{ID: id, Name: "Playlist", ContentType: "playlist", ContentID: uuid.New(), Timezone: "UTC"}},
	}
	if err := validateSnapshotShape(snapshot); err == nil || !strings.Contains(err.Error(), "listed more than once") {
		t.Fatalf("duplicate destination error = %v", err)
	}

	snapshot.Destinations = []Destination{{Type: "screen", ID: uuid.New()}}
	snapshot.Blocks = append(snapshot.Blocks, Block{ID: id, Name: "Other", ContentType: "layout", ContentID: uuid.New(), Timezone: "UTC"})
	if err := validateSnapshotShape(snapshot); err == nil || !strings.Contains(err.Error(), "content block") {
		t.Fatalf("duplicate block error = %v", err)
	}
}

func TestValidateSnapshotShapeRejectsInvalidScheduleTimezone(t *testing.T) {
	snapshot := Snapshot{
		Name:         "Morning",
		Timezone:     "UTC",
		Destinations: []Destination{{Type: "screen", ID: uuid.New()}},
		Blocks:       []Block{{ID: uuid.New(), Name: "Playlist", ContentType: "playlist", ContentID: uuid.New(), Timezone: "Not/AZone"}},
	}
	if err := validateSnapshotShape(snapshot); err == nil || !strings.Contains(err.Error(), "timezone") {
		t.Fatalf("invalid timezone error = %v", err)
	}
}
