package plugins

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func TestCountdownBarLifecycleAndManifestTargeting(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings,users CASCADE`); err != nil {
		t.Fatal(err)
	}
	organizationID, userID, locationID, groupID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	targetedScreen, otherScreen := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(TRUE,'Plugin Test',$1)`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,username,password_hash,role,active) VALUES($1,'Owner','plugin-owner','unused','owner',TRUE)`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO locations(id,organization_id,name) VALUES($1,$2,'Cafeteria')`, locationID, organizationID); err != nil {
		t.Fatal(err)
	}
	for _, record := range []struct {
		id       uuid.UUID
		location *uuid.UUID
		name     string
	}{{targetedScreen, &locationID, "Cafeteria"}, {otherScreen, nil, "Lobby"}} {
		if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,location_id,platform,
			device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone)
			VALUES($1,$2,$3,$4,$5,'linux','Test','Display','Linux','1',1920,1080,1,'en-US','UTC')`,
			record.id, organizationID, uuid.NewString(), record.name, record.location); err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, `INSERT INTO screen_manifest_state(screen_id) VALUES($1)`, record.id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screen_groups(id,organization_id,name,created_by) VALUES($1,$2,'Lunch screens',$3)`, groupID, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screen_group_memberships(screen_group_id,screen_id,added_by) VALUES($1,$2,$3)`, groupID, targetedScreen, userID); err != nil {
		t.Fatal(err)
	}

	service := NewService(pool, nil)
	input := validInput()
	input.ContentPadding = intPointer(0)
	input.TextScale = 175
	input.TargetScope = "locations"
	input.TargetIDs = []uuid.UUID{locationID}
	created, err := service.CreateCountdownBar(ctx, userID, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []struct {
		name  string
		scope string
		ids   []uuid.UUID
	}{
		{"All screens", "all", nil},
		{"One screen", "screens", []uuid.UUID{targetedScreen}},
		{"One group", "sync_groups", []uuid.UUID{groupID}},
	} {
		additional := validInput()
		additional.Name = target.name
		additional.TargetScope = target.scope
		additional.TargetIDs = target.ids
		if _, err = service.CreateCountdownBar(ctx, userID, additional); err != nil {
			t.Fatal(err)
		}
	}
	targeted, err := service.ManifestForScreen(ctx, targetedScreen)
	if err != nil || len(targeted) != 4 {
		t.Fatalf("targeted manifest: %#v %v", targeted, err)
	}
	var customMetricsFound bool
	for _, plugin := range targeted {
		if plugin.ID == created.ID {
			customMetricsFound = plugin.Config.ContentPadding == 0 && plugin.Config.TextScale == 175
		}
	}
	if created.ContentPadding == nil || *created.ContentPadding != 0 || created.TextScale != 175 || !customMetricsFound {
		t.Fatalf("custom text metrics were not persisted and projected: created=%#v manifest=%#v", created, targeted)
	}
	other, err := service.ManifestForScreen(ctx, otherScreen)
	if err != nil || len(other) != 1 || other[0].Config.Name != "All screens" {
		t.Fatalf("untargeted manifest: %#v %v", other, err)
	}

	created.Enabled = false
	created.ScheduleType = "one_time"
	created.TargetTime = nil
	created.DaysOfWeek = nil
	oneTimeAt := time.Now().UTC().Add(time.Hour)
	created.OneTimeAt = &oneTimeAt
	if _, err = service.UpdateCountdownBar(ctx, created.ID, userID, created.CountdownBarInput); err != nil {
		t.Fatal(err)
	}
	targeted, err = service.ManifestForScreen(ctx, targetedScreen)
	disabledLeaked := false
	for _, plugin := range targeted {
		disabledLeaked = disabledLeaked || plugin.ID == created.ID
	}
	if err != nil || disabledLeaked || len(targeted) != 3 {
		t.Fatalf("disabled instance leaked into manifest: %#v %v", targeted, err)
	}
	if err = service.DeleteCountdownBar(ctx, created.ID, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.GetCountdownBar(ctx, created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected deleted instance to be gone, got %v", err)
	}
	var revisions int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM screen_manifest_state WHERE manifest_version >= 4`).Scan(&revisions); err != nil {
		t.Fatal(err)
	}
	if revisions != 2 {
		t.Fatalf("expected every screen manifest to be revised for create/update/delete, got %d", revisions)
	}

	// The catalog is the list of what Tilecast can do. Emergency Alerts belongs
	// in it whether or not this installation has configured any of it, which is
	// what moving it out of Settings and into Plugins means.
	catalog, err := service.Catalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]CatalogPlugin{}
	for _, item := range catalog.Items {
		byID[item.ID] = item
	}
	if len(catalog.Items) != 3 || byID["countdown_bar"].Name == "" || byID["emergency_alerts"].Name == "" || byID["forms"].Name == "" {
		t.Fatalf("catalog = %+v, want Countdown Bar, Emergency Alerts, and Forms", catalog.Items)
	}
	if alerts := byID["emergency_alerts"]; alerts.Enabled || alerts.InstanceCount != 0 {
		t.Fatalf("unconfigured Emergency Alerts = %+v, want disabled with no rules", alerts)
	}
	if forms := byID["forms"]; !forms.Enabled || forms.InstanceCount != 0 {
		t.Fatalf("unconfigured Forms = %+v, want enabled with no forms", forms)
	}
	// The migration seeds the singleton row, but this test truncates users, and
	// TRUNCATE ... CASCADE reaches every table referencing it.
	if _, err = pool.Exec(ctx, `INSERT INTO alert_monitor(singleton,enabled) VALUES(TRUE,TRUE)
		ON CONFLICT(singleton) DO UPDATE SET enabled=TRUE`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO alert_rules(id,organization_id,name,created_by) VALUES($1,$2,'Tornado Warning',$3)`,
		uuid.New(), organizationID, userID); err != nil {
		t.Fatal(err)
	}
	catalog, err = service.Catalog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range catalog.Items {
		if item.ID != "emergency_alerts" {
			continue
		}
		// Monitoring is what "enabled" means here; the rules are the instances.
		if !item.Enabled || item.InstanceCount != 1 {
			t.Fatalf("configured Emergency Alerts = %+v, want enabled with one rule", item)
		}
	}
}
