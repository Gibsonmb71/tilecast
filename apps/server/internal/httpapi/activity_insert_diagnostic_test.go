package httpapi

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestActivityInsertDiagnostic(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		tx, err := env.pool.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(context.Background()) //nolint:errcheck
		started := time.Now().UTC().Add(-30 * time.Second).Truncate(time.Microsecond)
		events := []playerActivityEventInput{
			{ID: uuid.New(), Sequence: 1, EventType: "playlist_item.started", OccurredAt: started, PlayerTimezone: "America/New_York", ManifestVersion: int64Pointer(42), PresentationType: "playlist", PresentationID: "morning", PresentationRev: "3", ContentType: "media", ContentID: "welcome-video", PlaylistItemID: "item-1", ActivitySessionID: "session-1", Result: "playing", ExpectedDurationMS: int64Pointer(30_000), TriggerContext: "schedule", ScheduleID: "schedule-1"},
			{ID: uuid.New(), Sequence: 2, EventType: "playlist_item.completed", OccurredAt: started.Add(30 * time.Second), PlayerTimezone: "America/New_York", ManifestVersion: int64Pointer(42), PresentationType: "playlist", PresentationID: "morning", ContentType: "media", ContentID: "welcome-video", PlaylistItemID: "item-1", ActivitySessionID: "session-1", Result: "completed", DurationMS: int64Pointer(30_000)},
		}
		r := httptest.NewRequest("POST", "/api/v1/player/activity-events", nil)
		for index := range events {
			if err := normalizePlayerActivity(&events[index], time.Now().UTC()); err != nil {
				t.Fatalf("normalize event %d: %v", index+1, err)
			}
			inserted, err := env.server.insertPlayerActivityEvent(r, tx, env.screenID, events[index])
			if err != nil {
				t.Fatalf("insert raw event %d: %v", index+1, err)
			}
			if !inserted {
				t.Fatalf("raw event %d was not inserted", index+1)
			}
			if err := env.server.derivePlayerActivity(r, tx, env.screenID, events[index]); err != nil {
				t.Fatalf("derive event %d: %v", index+1, err)
			}
		}
		if err := closeExpiredPlaybackSessions(r, tx, env.screenID, time.Now().UTC()); err != nil {
			t.Fatalf("close expired sessions: %v", err)
		}
	})
}
