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
		if err != nil { t.Fatal(err) }
		defer tx.Rollback(context.Background()) //nolint:errcheck
		event := playerActivityEventInput{
			ID: uuid.New(), Sequence: 1, EventType: "presentation.started",
			Category: "manifest", Severity: "info", OccurredAt: time.Now().UTC(),
			PlayerTimezone: "UTC", PresentationType: "playlist", PresentationID: "diagnostic",
			ActivitySessionID: "diagnostic-session", Result: "playing",
		}
		r := httptest.NewRequest("POST", "/api/v1/player/activity-events", nil)
		inserted, err := env.server.insertPlayerActivityEvent(r, tx, env.screenID, event)
		if err != nil { t.Fatalf("insert raw event: %v", err) }
		if !inserted { t.Fatal("raw event was not inserted") }
		if err := env.server.derivePlayerActivity(r, tx, env.screenID, event); err != nil {
			t.Fatalf("derive session: %v", err)
		}
	})
}
