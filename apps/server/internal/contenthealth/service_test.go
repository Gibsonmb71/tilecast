package contenthealth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
)

type stubSettings struct{ values map[string]any }

func (s stubSettings) Organization(context.Context) (settings.Document, error) {
	return settings.Document{Values: s.values}, nil
}

func TestThresholdsFallBackToRegistryDefaults(t *testing.T) {
	svc := NewService(nil, stubSettings{values: map[string]any{}})
	got, err := svc.thresholds(context.Background())
	if err != nil {
		t.Fatalf("thresholds: %v", err)
	}
	if got.StaleSourceHours != 12 || got.ExpiringMediaDays != 14 {
		t.Errorf("thresholds = %+v, want 12h and 14 days", got)
	}
}

func TestThresholdsReadConfiguredValues(t *testing.T) {
	svc := NewService(nil, stubSettings{values: map[string]any{
		"content_health.stale_source_hours":  float64(2),
		"content_health.expiring_media_days": float64(30),
	}})
	got, _ := svc.thresholds(context.Background())
	if got.StaleSourceHours != 2 || got.ExpiringMediaDays != 30 {
		t.Errorf("thresholds = %+v", got)
	}
}

func TestThresholdsRejectNonPositiveValues(t *testing.T) {
	// A zero would make every source stale the moment it refreshed.
	svc := NewService(nil, stubSettings{values: map[string]any{
		"content_health.stale_source_hours": float64(0),
	}})
	got, _ := svc.thresholds(context.Background())
	if got.StaleSourceHours != 12 {
		t.Errorf("stale hours = %d, want the default", got.StaleSourceHours)
	}
}

func TestReportHealthy(t *testing.T) {
	empty := Report{}
	if !empty.Healthy() {
		t.Error("an empty report must read as healthy")
	}
	withExpiry := Report{ExpiringAssets: []ExpiringAsset{{
		ID: uuid.New(), Name: "Fall concert", ExpiresAt: time.Now().Add(time.Hour),
	}}}
	if withExpiry.Healthy() {
		t.Error("expiring media must count as something to look at")
	}
	withScreens := Report{UnassignedScreens: []UnassignedScreen{{ID: uuid.New(), Name: "Lobby"}}}
	if withScreens.Healthy() {
		t.Error("a screen with nothing assigned must be reported")
	}
}
