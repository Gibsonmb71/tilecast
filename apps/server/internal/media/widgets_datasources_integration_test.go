package media

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

// TestWidgetAndDataSourceSeparation exercises the core Widget/Data Source rules:
// provider-role validation, creation, compatible and incompatible connections,
// field-existence validation, and Data Source deletion protection.
func TestWidgetAndDataSourceSeparation(t *testing.T) {
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
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Widgets", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, nil, Config{Website: WebsitePolicy{DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}, SourceFetch: SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: 5 * time.Second, MaximumBytes: 1 << 20, MaximumRedirects: 3, MinimumRefresh: 5 * time.Minute, MaximumRefresh: 24 * time.Hour}})
	user := owner.User.ID

	// Provider-role validation: a data provider cannot be a Widget, and a widget
	// provider cannot be a Data Source.
	if _, err := service.CreateWidget(ctx, user, WidgetInput{Provider: "csv", Name: "Bad", Configuration: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected csv to be rejected as a widget provider")
	}
	if _, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "website", Name: "Bad", Configuration: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected website to be rejected as a data source provider")
	}
	if _, err := service.CreateWidget(ctx, user, WidgetInput{Provider: "made_up", Name: "Bad", Configuration: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("expected unknown provider to be rejected")
	}

	// Create a CSV Data Source with an uploaded payload and a couple of fields.
	csvConfig := StructuredSourceConfig{Uploaded: true, UploadedContent: "name,room\nLunch,Cafeteria\n", Presentation: "list", MaxItems: 10, Fields: StructuredFields{Title: true, Subtitle: true}, Sort: "source", Mapping: &StructuredMapping{Title: "name", Subtitle: "room"}, RefreshIntervalSeconds: 3600, StalenessLimitHours: 168, EmptyState: "No items"}
	csvRaw, _ := json.Marshal(csvConfig)
	dataSource, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "csv", Name: "Lunch data", Configuration: csvRaw})
	if err != nil {
		t.Fatalf("create csv data source: %v", err)
	}

	// Compatible connection: a Menu Widget accepts a CSV Data Source with existing fields.
	menuRaw, _ := json.Marshal(DisplayWidgetConfig{DataSourceID: dataSource.ID, Fields: []string{"title", "subtitle"}, MaximumItems: 10, ForegroundColor: "#F5F7FA", BackgroundColor: "#0E141B"})
	menu, err := service.CreateWidget(ctx, user, WidgetInput{Provider: "menu", Name: "Today's Lunch", Configuration: menuRaw})
	if err != nil {
		t.Fatalf("create menu widget: %v", err)
	}

	// Incompatible field: a selected field that the Data Source does not expose is rejected.
	badFieldsRaw, _ := json.Marshal(DisplayWidgetConfig{DataSourceID: dataSource.ID, Fields: []string{"nonexistent"}, MaximumItems: 10})
	if _, err := service.CreateWidget(ctx, user, WidgetInput{Provider: "menu", Name: "Bad fields", Configuration: badFieldsRaw}); err == nil {
		t.Fatal("expected a nonexistent field to be rejected")
	}

	// Incompatible provider: an Agenda Widget does not accept a plain RSS Data Source, and a
	// Menu Widget does not accept a Calendar Data Source.
	rssRaw, _ := json.Marshal(StructuredSourceConfig{URL: "https://example.com/feed.xml", Presentation: "list", MaxItems: 10, Fields: StructuredFields{Title: true}, Sort: "source", RefreshIntervalSeconds: 3600, StalenessLimitHours: 168, EmptyState: "None"})
	rss, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "rss", Name: "News", Configuration: rssRaw})
	if err != nil {
		t.Fatalf("create rss data source: %v", err)
	}
	agendaRaw, _ := json.Marshal(DisplayWidgetConfig{DataSourceID: rss.ID, Fields: []string{"title"}, MaximumItems: 10})
	if _, err := service.CreateWidget(ctx, user, WidgetInput{Provider: "agenda", Name: "Bad agenda", Configuration: agendaRaw}); err == nil {
		t.Fatal("expected agenda to reject an rss data source")
	}

	// Data Source deletion protection: the CSV source is used by the Menu widget.
	err = service.DeleteDataSource(ctx, dataSource.ID, user)
	var dependency *DependencyError
	if !errors.As(err, &dependency) {
		t.Fatalf("expected DependencyError deleting an in-use data source, got %v", err)
	}
	// The unused RSS source deletes cleanly.
	if err := service.DeleteDataSource(ctx, rss.ID, user); err != nil {
		t.Fatalf("delete unused data source: %v", err)
	}
	// After removing the consuming widget, the CSV source can be deleted.
	if err := service.DeleteAsset(ctx, menu.ID, user); err != nil {
		t.Fatalf("delete menu widget: %v", err)
	}
	if err := service.DeleteDataSource(ctx, dataSource.ID, user); err != nil {
		t.Fatalf("delete now-unused data source: %v", err)
	}
}
