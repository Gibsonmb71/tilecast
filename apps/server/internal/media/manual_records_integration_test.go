package media

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

// TestManualRecordsSourceStoresAndSchedulesItsWindow exercises the manual_records adapter
// end to end against PostgreSQL: creating a Data Source stores the projected rows, hides
// rows outside their publish window, and schedules the Data Source to wake at the next
// boundary rather than at a polling interval.
func TestManualRecordsSourceStoresAndSchedulesItsWindow(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer lockPool.Close()
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	if _, err := lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	defer lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) //nolint:errcheck
	if err := database.Migrate(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `TRUNCATE data_source_refresh_states,data_sources,widgets,website_assets,asset_variants,assets,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "District", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, nil, Config{Website: WebsitePolicy{DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}, SourceFetch: SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: 5 * time.Second, MaximumBytes: 1 << 20, MaximumRedirects: 3, MinimumRefresh: 5 * time.Minute, MaximumRefresh: 24 * time.Hour}})
	user := owner.User.ID

	expires := time.Now().Add(90 * time.Minute).UTC().Format(time.RFC3339)
	publishes := time.Now().Add(4 * time.Hour).UTC().Format(time.RFC3339)
	createRaw, _ := json.Marshal(map[string]any{"records": []any{
		map[string]any{"title": "Book sale today", "body": "Front lobby.", "priority": 10},
		map[string]any{"title": "Closing early", "body": "Doors at four.", "priority": 50, "expiresAt": expires},
		map[string]any{"title": "Next week", "body": "Not yet visible.", "priority": 0, "publishAt": publishes},
	}})
	dataSource, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "announcements", Name: "Announcements", Configuration: createRaw})
	if err != nil {
		t.Fatalf("create manual records source: %v", err)
	}

	// The Player receives only the rows inside their window, highest priority first.
	projected, err := service.PlayerTypedDataSourceConfiguration(ctx, dataSource.ID, "announcements", dataSource.Configuration)
	if err != nil {
		t.Fatalf("project manual records payload: %v", err)
	}
	var payload TypedDatasetPayload
	if err := json.Unmarshal(projected, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Datasets) != 1 || payload.Datasets[0].Kind != "records" || payload.Datasets[0].ID != "records" {
		t.Fatalf("unexpected payload shape: %#v", payload)
	}
	records := payload.Datasets[0].Records
	if len(records) != 2 {
		t.Fatalf("expected the unpublished row to be withheld, got %d rows", len(records))
	}
	if records[0].Values["title"] != "Closing early" {
		t.Fatalf("expected priority ordering, got %q first", records[0].Values["title"])
	}

	// The refresh state is scheduled for the earliest window boundary, so the row that ends
	// in ninety minutes disappears then without the worker polling in the meantime.
	var nextRefresh time.Time
	var itemCount int
	if err := pool.QueryRow(ctx, `SELECT next_refresh_at,available_item_count FROM data_source_refresh_states WHERE data_source_id=$1`, dataSource.ID).Scan(&nextRefresh, &itemCount); err != nil {
		t.Fatal(err)
	}
	if itemCount != 2 {
		t.Fatalf("expected the visible row count to be recorded, got %d", itemCount)
	}
	untilBoundary := time.Until(nextRefresh)
	if untilBoundary < 80*time.Minute || untilBoundary > 100*time.Minute {
		t.Fatalf("expected the next refresh at the ninety-minute boundary, got %s from now", untilBoundary)
	}

	// A table with no windows at all is never rescheduled.
	staticRaw, _ := json.Marshal(map[string]any{"records": []any{
		map[string]any{"title": "Always visible", "body": "No window.", "priority": 0},
	}})
	staticSource, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "announcements", Name: "Standing Notices", Configuration: staticRaw})
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT next_refresh_at FROM data_source_refresh_states WHERE data_source_id=$1`, staticSource.ID).Scan(&nextRefresh); err != nil {
		t.Fatal(err)
	}
	if time.Until(nextRefresh) < 365*24*time.Hour {
		t.Fatalf("expected a table without windows to sit idle, next refresh is %s away", time.Until(nextRefresh))
	}

	// Studio previews resolve through the same projection.
	preview, err := service.PreviewDataSourceByID(ctx, dataSource.ID, "")
	if err != nil {
		t.Fatalf("preview by id: %v", err)
	}
	previewPayload, ok := preview.(TypedDatasetPayload)
	if !ok || len(previewPayload.Datasets) != 1 || len(previewPayload.Datasets[0].Records) != 2 {
		t.Fatalf("preview did not match the stored payload: %#v", preview)
	}

	// Field discovery comes from the definition's output schema.
	detail, err := service.GetDataSourceDetail(ctx, dataSource.ID)
	if err != nil {
		t.Fatal(err)
	}
	keys := map[string]bool{}
	for _, field := range detail.Fields {
		keys[field.Key] = true
	}
	for _, want := range []string{"title", "body", "category", "priority", "publishAt", "expiresAt"} {
		if !keys[want] {
			t.Fatalf("field %q missing from definition-driven discovery: %#v", want, keys)
		}
	}
}
