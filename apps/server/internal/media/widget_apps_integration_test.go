package media

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func TestAppRecipeManagedSourceLifecycle(t *testing.T) {
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
	if _, err = lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	defer lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) //nolint:errcheck
	if err = database.Migrate(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, `TRUNCATE data_source_refresh_states,data_sources,widgets,website_assets,asset_variants,assets,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Apps", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, nil, Config{Website: WebsitePolicy{DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}, SourceFetch: SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: 5 * time.Second, MaximumBytes: 1 << 20, MaximumRedirects: 3, MinimumRefresh: 5 * time.Minute, MaximumRefresh: 24 * time.Hour}})
	input := WidgetInput{
		Provider: "espn", Name: "Lobby sports",
		Configuration: json.RawMessage(`{"feedUrl":"https://www.espn.com/espn/rss/news","heading":"ESPN","maxStories":8,"displayStyle":"headlines","showDescription":true,"showPublicationTime":true,"showSource":false,"skipWhenEmpty":false,"refreshIntervalSeconds":900,"emptyState":"No headlines"}`),
	}
	app, err := service.CreateWidget(ctx, owner.User.ID, input)
	if err != nil {
		t.Fatalf("create App: %v", err)
	}
	if app.Widget == nil || app.Widget.ManagedDataSourceID == nil || len(app.Widget.AuthorConfiguration) == 0 {
		t.Fatalf("App ownership was not returned: %#v", app.Widget)
	}
	originalSource := *app.Widget.ManagedDataSourceID
	var systemManaged bool
	var sourceURL string
	if err = pool.QueryRow(ctx, `SELECT system_managed,configuration->>'url' FROM data_sources WHERE id=$1`, originalSource).Scan(&systemManaged, &sourceURL); err != nil || !systemManaged || sourceURL != "https://www.espn.com/espn/rss/news" {
		t.Fatalf("managed=%v url=%q err=%v", systemManaged, sourceURL, err)
	}

	duplicate, err := service.DuplicateWidget(ctx, app.ID, owner.User.ID)
	if err != nil {
		t.Fatalf("duplicate App: %v", err)
	}
	if duplicate.Widget == nil || duplicate.Widget.ManagedDataSourceID == nil || *duplicate.Widget.ManagedDataSourceID == originalSource {
		t.Fatalf("duplicate reused managed source: %#v", duplicate.Widget)
	}

	input.Name = "Lobby basketball"
	input.Configuration = json.RawMessage(`{"feedUrl":"https://www.espn.com/espn/rss/nba/news","heading":"NBA","maxStories":6,"displayStyle":"compact","showDescription":false,"showPublicationTime":true,"showSource":false,"skipWhenEmpty":true,"refreshIntervalSeconds":1800,"emptyState":"No NBA headlines"}`)
	updated, err := service.UpdateWidget(ctx, app.ID, owner.User.ID, input)
	if err != nil {
		t.Fatalf("update App: %v", err)
	}
	if updated.Widget == nil || updated.Widget.ManagedDataSourceID == nil || *updated.Widget.ManagedDataSourceID != originalSource {
		t.Fatal("editing App replaced its ownership relationship")
	}
	if err = pool.QueryRow(ctx, `SELECT configuration->>'url' FROM data_sources WHERE id=$1`, originalSource).Scan(&sourceURL); err != nil || sourceURL != "https://www.espn.com/espn/rss/nba/news" {
		t.Fatalf("managed source was not edited: url=%q err=%v", sourceURL, err)
	}

	// Simulate a legacy/advanced consumer retaining the managed source through a nested
	// configuration. The old jsonb_each_text cleanup missed this shape entirely; the
	// declarative repeating_group path is covered separately by the dependency unit test.
	consumerID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,processing_status,created_by) SELECT $1,id,'Shared consumer','widget','','application/vnd.tilecast.widget+json',''::bytea,0,'ready',$2 FROM organization_settings WHERE singleton`, consumerID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO widgets(asset_id,provider,configuration) VALUES($1,'legacy-test',jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('dataSourceId',$2::text))))`, consumerID, originalSource); err != nil {
		t.Fatal(err)
	}
	usage, err := service.dataSourceWidgetUsage(ctx, originalSource)
	if err != nil {
		t.Fatal(err)
	}
	if len(usage) != 2 {
		t.Fatalf("expected owner App and nested consumer in usage, got %#v", usage)
	}
	if err = service.DeleteAsset(ctx, app.ID, owner.User.ID); err != nil {
		t.Fatalf("delete shared App: %v", err)
	}
	var deletedAt *time.Time
	if err = pool.QueryRow(ctx, `SELECT system_managed,deleted_at FROM data_sources WHERE id=$1`, originalSource).Scan(&systemManaged, &deletedAt); err != nil || systemManaged || deletedAt != nil {
		t.Fatalf("shared source was not promoted: managed=%v deleted=%v err=%v", systemManaged, deletedAt, err)
	}

	duplicateSource := *duplicate.Widget.ManagedDataSourceID
	if err = service.DeleteAsset(ctx, duplicate.ID, owner.User.ID); err != nil {
		t.Fatalf("delete unshared App: %v", err)
	}
	if err = pool.QueryRow(ctx, `SELECT deleted_at FROM data_sources WHERE id=$1`, duplicateSource).Scan(&deletedAt); err != nil || deletedAt == nil {
		t.Fatalf("unshared managed source was not cleaned up: deleted=%v err=%v", deletedAt, err)
	}
}
