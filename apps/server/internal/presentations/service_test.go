package presentations

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCreateRejectsInvalidQuickPresentInputBeforeDatabaseAccess(t *testing.T) {
	service := NewService(nil, nil)
	cases := []struct {
		name  string
		input CreateInput
	}{
		{name: "target type", input: CreateInput{TargetType: "display", TargetID: uuid.New(), ContentType: "playlist", ContentID: uuid.New()}},
		{name: "content type", input: CreateInput{TargetType: "screen", TargetID: uuid.New(), ContentType: "command", ContentID: uuid.New()}},
		{name: "missing ids", input: CreateInput{TargetType: "screen", ContentType: "playlist"}},
		{name: "after action", input: CreateInput{TargetType: "screen", TargetID: uuid.New(), ContentType: "playlist", ContentID: uuid.New(), AfterAction: "snapshot"}},
		{name: "duration", input: CreateInput{TargetType: "screen", TargetID: uuid.New(), ContentType: "playlist", ContentID: uuid.New(), Duration: 3 * time.Minute}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := service.Create(t.Context(), tc.input); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Create error=%v, want ErrInvalid", err)
			}
		})
	}
}

func TestManifestProjectionKeepsQuickPresentContentContract(t *testing.T) {
	id, targetID, contentID := uuid.New(), uuid.New(), uuid.New()
	started := time.Date(2026, time.July, 17, 15, 0, 0, 0, time.UTC)
	expires := started.Add(15 * time.Minute)
	projection := (Override{
		ID: id, TargetType: "group", TargetID: targetID, ContentType: "playlist", ContentID: contentID,
		ContentName: "Open house", StartedAt: started, ExpiresAt: &expires, WakeDisplay: true,
	}).ManifestProjection()
	if projection.ID != id || projection.TargetType != "group" || projection.TargetID != targetID || projection.ContentID != contentID || projection.ContentName != "Open house" || !projection.StartedAt.Equal(started) || projection.ExpiresAt == nil || !projection.WakeDisplay {
		t.Fatalf("projection=%#v", projection)
	}
}
