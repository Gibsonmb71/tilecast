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
	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

// TestProviderConstraintsValidateShapeNotEnumeration proves the database no longer enumerates
// providers: it accepts any catalog-supported provider and any shape-valid identifier, rejects
// malformed identifiers, and lets a new catalog definition work without a schema migration.
// Application validation remains responsible for rejecting unknown provider IDs.
func TestProviderConstraintsValidateShapeNotEnumeration(t *testing.T) {
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
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Providers", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, nil, Config{Website: WebsitePolicy{DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}, SourceFetch: SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: 5 * time.Second, MaximumBytes: 1 << 20, MaximumRedirects: 3, MinimumRefresh: 5 * time.Minute, MaximumRefresh: 24 * time.Hour}})
	user := owner.User.ID

	// A provider in the catalog is accepted.
	if _, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "school-status", Name: "Status", Configuration: json.RawMessage(`{"status":"Open","message":"Normal","severity":"normal"}`)}); err != nil {
		t.Fatalf("catalog provider was rejected: %v", err)
	}

	// An unknown provider is rejected by application validation, before any insert.
	if _, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "not-in-catalog", Name: "Nope", Configuration: json.RawMessage(`{}`)}); err == nil {
		t.Fatal("unknown provider was accepted by application validation")
	}

	// A malformed provider id is rejected by the database shape constraint (spaces and
	// uppercase are not allowed).
	if _, err := pool.Exec(ctx, `INSERT INTO data_sources(id,organization_id,name,provider,config_version,configuration,created_by)VALUES($1,$2,'Malformed','Bad Provider!',1,'{}'::jsonb,$3)`, uuid.New(), org, user); err == nil {
		t.Fatal("malformed provider id was accepted by the database")
	}

	// Adding a new catalog definition requires no new migration: with the current schema,
	// a source using a brand-new shape-valid provider from an injected catalog is created.
	custom := contentdefs.DataSourceDefinition{
		ID: "campus-note", Version: 1, Name: "Campus Note", Category: "Test",
		AdapterID:            "manual_object",
		ConfigurationSchema:  contentdefs.ConfigurationSchema{Fields: []contentdefs.FieldDefinition{{Key: "note", Label: "Note", Control: "text"}}},
		DefaultConfiguration: map[string]any{},
		OutputSchema:         contentdefs.OutputSchema{Kind: "object", Fields: []contentdefs.OutputField{{Key: "note", Label: "Note", Type: "text"}}},
	}
	catalog, err := contentdefs.New(nil, []contentdefs.DataSourceDefinition{custom})
	if err != nil {
		t.Fatal(err)
	}
	service.SetContentDefinitions(catalog)
	if _, err := service.CreateDataSource(ctx, user, DataSourceInput{Provider: "campus-note", Name: "Campus", Configuration: json.RawMessage(`{"note":"Welcome"}`)}); err != nil {
		t.Fatalf("new catalog definition required a migration: %v", err)
	}
}
