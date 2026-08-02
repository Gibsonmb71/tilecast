package playlists

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

// capabilityFixture holds the wired services and identifiers a capability-check test needs.
type capabilityFixture struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	service *Service
	media   *media.Service
	org     uuid.UUID
	user    uuid.UUID
	screen  uuid.UUID
}

func setupCapabilityFixture(t *testing.T) *capabilityFixture {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(lockPool.Close)
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(lock.Release)
	if _, err := lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) }) //nolint:errcheck
	if err := database.Migrate(ctx, databaseURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `TRUNCATE presentation_overrides,takeover_screen_states,takeover_targets,takeovers,screen_group_memberships,screen_groups,screen_player_status,screen_manifest_state,screen_playlist_assignments,playlist_items,playlists,layout_revision_dependencies,layout_revisions,layouts,data_source_refresh_states,data_sources,widgets,asset_variants,assets,screens,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "District", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	screen := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone)VALUES($1,$2,$3,'Lobby','android-tv','Google','ADT-3','14','0.4.0',1920,1080,2,'en-US','UTC')`, screen, org, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	mediaService := media.NewService(pool, nil, media.Config{Website: media.WebsitePolicy{DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}, SourceFetch: media.SourceFetchPolicy{AllowPrivateNetworks: true, Timeout: 5 * time.Second, MaximumBytes: 1 << 20, MaximumRedirects: 3, MinimumRefresh: 5 * time.Minute, MaximumRefresh: 24 * time.Hour}})
	service := NewService(pool, nil)
	service.SetSourceProjector(mediaService)
	return &capabilityFixture{ctx: ctx, pool: pool, service: service, media: mediaService, org: org, user: owner.User.ID, screen: screen}
}

// addReadyImageToPlaylist gives tests that exercise assignment/readiness a
// real player-compatible presentation. Keeping this in the integration
// fixture makes the readiness contract explicit instead of weakening the
// production validator for otherwise empty test playlists.
func (f *capabilityFixture) addReadyImageToPlaylist(t *testing.T, playlistID uuid.UUID) {
	t.Helper()
	assetID, variantID := uuid.New(), uuid.New()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by)VALUES($1,$2,'Test image','image','test.png','image/png',$3,100,1920,1080,'ready',$4)`, assetID, f.org, make([]byte, 32), f.user); err != nil {
		t.Fatalf("insert test image: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible)VALUES($1,$2,'original','local',$3,'image/png',100,$4,1920,1080,TRUE)`, variantID, assetID, "originals/"+assetID.String(), make([]byte, 32)); err != nil {
		t.Fatalf("insert test image variant: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO playlist_items(id,playlist_id,asset_id,position,duration_ms)SELECT $1,$2,$3,COALESCE(MAX(position)+1,0),10000 FROM playlist_items WHERE playlist_id=$2`, uuid.New(), playlistID, assetID); err != nil {
		t.Fatalf("insert test playlist item: %v", err)
	}
}

// createSchoolStatusSource creates the release-defined School Status Data Source, which
// requires manifest v13 (Data Document v1).
func (f *capabilityFixture) createSchoolStatusSource(t *testing.T, name string) uuid.UUID {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"status": "Two-hour delay", "message": "Buses run late.", "severity": "warning"})
	source, err := f.media.CreateDataSource(f.ctx, f.user, media.DataSourceInput{Provider: "school-status", Name: name, Configuration: raw})
	if err != nil {
		t.Fatalf("create school-status source: %v", err)
	}
	return source.ID
}

// createLayoutBoundToSource creates a published Layout whose only reachable dependency is a
// direct Data Source binding (a text or visibility binding), with no Widget involved.
func (f *capabilityFixture) createLayoutBoundToSource(t *testing.T, sourceID uuid.UUID) uuid.UUID {
	t.Helper()
	layoutID, revisionID := uuid.New(), uuid.New()
	placementID := uuid.New()
	documentBytes, err := json.Marshal(map[string]any{
		"schemaVersion": 2,
		"canvas": map[string]any{
			"width": 1920, "height": 1080, "orientation": "landscape",
			"backgroundColor": "#000000", "safeAreaPercent": 0,
		},
		"placements": []any{map[string]any{
			"id": placementID, "type": "primitive", "name": "Status",
			"x": 0, "y": 0, "width": 1920, "height": 1080,
			"layer": 0, "opacity": 1, "visible": true, "locked": false,
			"primitive": map[string]any{
				"kind": "text", "text": "Status", "color": "#FFFFFF",
				"binding": map[string]any{"dataSourceId": sourceID, "field": "status"},
			},
		}},
	})
	if err != nil {
		t.Fatalf("marshal source layout: %v", err)
	}
	document := string(documentBytes)
	sum := sha256.Sum256([]byte(document))
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO layouts(id,organization_id,name,orientation,canvas_width,canvas_height,draft_document,created_by)VALUES($1,$2,'Status Board','landscape',1920,1080,$3::jsonb,$4)`, layoutID, f.org, document, f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO layout_revisions(id,layout_id,revision,document,document_sha256,published_by)VALUES($1,$2,1,$3::jsonb,$4,$5)`, revisionID, layoutID, document, hex.EncodeToString(sum[:]), f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE layouts SET published_revision_id=$2 WHERE id=$1`, layoutID, revisionID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO layout_revision_dependencies(revision_id,dependency_type,dependency_id)VALUES($1,'data_source',$2)`, revisionID, sourceID); err != nil {
		t.Fatal(err)
	}
	return layoutID
}

// reportV13Capabilities marks the screen as a compatible v13 Player.
func (f *capabilityFixture) reportV13Capabilities(t *testing.T) {
	t.Helper()
	capabilities, _ := json.Marshal(NativePresentationCapabilities)
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO screen_player_status(screen_id,presentation_schema_versions,native_presentation_capabilities,web_runtime_version,player_version_code)VALUES($1,'{1}',$2,1,22) ON CONFLICT(screen_id) DO UPDATE SET presentation_schema_versions='{1}',native_presentation_capabilities=EXCLUDED.native_presentation_capabilities,web_runtime_version=1,player_version_code=22`, f.screen, capabilities); err != nil {
		t.Fatal(err)
	}
}

// TestSourceOnlyV13ContentRejectedOnLegacyScreen proves a Layout bound directly to a v13-only
// Data Source (no Widget) is rejected before assignment on a legacy Player, that assignment
// validation and manifest requirements agree, and that a compatible v13 Player accepts it.
func TestSourceOnlyV13ContentRejectedOnLegacyScreen(t *testing.T) {
	f := setupCapabilityFixture(t)
	sourceID := f.createSchoolStatusSource(t, "District Status")
	layoutID := f.createLayoutBoundToSource(t, sourceID)

	// Legacy Player (no reported presentation capabilities): rejected before assignment.
	err := f.service.ValidatePresentationTargets(f.ctx, nil, &layoutID, []uuid.UUID{f.screen}, nil)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected source-only v13 content to be rejected on a legacy Player, got %v", err)
	}
	message := err.Error()
	// Part 10: the message names the screen and the Data Source, states the requirement,
	// and never leaks the internal database id.
	if !strings.Contains(message, "Lobby") || !strings.Contains(message, "District Status") {
		t.Fatalf("message did not identify the screen and Data Source: %q", message)
	}
	if !strings.Contains(message, "Data Document v1 and manifest v13") {
		t.Fatalf("message did not state the requirement: %q", message)
	}
	if strings.Contains(message, sourceID.String()) {
		t.Fatalf("message leaked the internal Data Source id: %q", message)
	}

	// A compatible v13 Player accepts the same content.
	f.reportV13Capabilities(t)
	if err := f.service.ValidatePresentationTargets(f.ctx, nil, &layoutID, []uuid.UUID{f.screen}, nil); err != nil {
		t.Fatalf("compatible v13 Player rejected valid content: %v", err)
	}
}

// TestScheduleAndTakeoverTargetingIncompatibleScreen proves the shared presentation-target
// check (used by schedules and takeover presentations) rejects v13-only content on a legacy
// screen, both when targeting the screen directly and through a screen group.
func TestScheduleAndTakeoverTargetingIncompatibleScreen(t *testing.T) {
	f := setupCapabilityFixture(t)
	sourceID := f.createSchoolStatusSource(t, "District Status")
	layoutID := f.createLayoutBoundToSource(t, sourceID)

	// Takeover-style: direct screen target.
	if err := f.service.ValidatePresentationTargets(f.ctx, nil, &layoutID, []uuid.UUID{f.screen}, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("takeover targeting an incompatible screen was not rejected: %v", err)
	}

	// Schedule/group-style: the screen is reachable through a screen group.
	group := uuid.New()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO screen_groups(id,organization_id,name,created_by)VALUES($1,$2,'Lobby Displays',$3)`, group, f.org, f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO screen_group_memberships(screen_group_id,screen_id,added_by)VALUES($1,$2,$3)`, group, f.screen, f.user); err != nil {
		t.Fatal(err)
	}
	if err := f.service.ValidatePresentationTargets(f.ctx, nil, &layoutID, nil, []uuid.UUID{group}); !errors.Is(err, ErrConflict) {
		t.Fatalf("schedule targeting an incompatible screen group was not rejected: %v", err)
	}

	// Once every group member reports v13 capabilities, the same content is accepted.
	f.reportV13Capabilities(t)
	if err := f.service.ValidatePresentationTargets(f.ctx, nil, &layoutID, nil, []uuid.UUID{group}); err != nil {
		t.Fatalf("compatible v13 group member rejected valid content: %v", err)
	}
}

// TestWidgetUsingV13SourceRejectedOnLegacyScreen proves a playlist whose Widget consumes a
// v13-only Data Source is rejected on a legacy Player and accepted on a v13 Player, and that
// direct assignment enforces the same rule as scheduling.
func TestWidgetUsingV13SourceRejectedOnLegacyScreen(t *testing.T) {
	f := setupCapabilityFixture(t)
	sourceID := f.createSchoolStatusSource(t, "District Status")

	bannerConfig, _ := json.Marshal(map[string]any{
		"dataSourceId": sourceID.String(), "heading": "District status",
		"statusField": "status", "messageField": "message", "severityField": "severity",
		"showUpdatedTime": true, "foregroundColor": "#ffffff", "backgroundColor": "#17324d",
		"emptyState": "Status is unavailable",
	})
	widget, err := f.media.CreateWidget(f.ctx, f.user, media.WidgetInput{Provider: "school-status-banner", Name: "Status Banner", Configuration: bannerConfig})
	if err != nil {
		t.Fatalf("create banner widget: %v", err)
	}
	playlist, err := f.service.Create(f.ctx, f.user, "Status rotation", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	duration := int64(30_000)
	if _, err := f.service.AddItem(f.ctx, playlist.ID, f.user, ItemInput{AssetID: widget.ID, DurationMS: &duration, DeliveryPolicy: "stream"}); err != nil {
		t.Fatal(err)
	}

	// Legacy Player: both scheduling validation and direct assignment reject.
	if err := f.service.ValidatePresentationTargets(f.ctx, &playlist.ID, nil, []uuid.UUID{f.screen}, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("v13 Widget content was not rejected on a legacy Player: %v", err)
	}
	if _, err := f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); !errors.Is(err, ErrConflict) {
		t.Fatalf("direct assignment of v13 content to a legacy Player was not rejected: %v", err)
	}

	// Compatible v13 Player: assignment succeeds and the manifest builds at schema 13.
	f.reportV13Capabilities(t)
	if _, err := f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); err != nil {
		t.Fatalf("compatible v13 Player rejected valid content: %v", err)
	}
	manifest, _, err := f.service.BuildManifest(f.ctx, f.screen)
	if err != nil || manifest.SchemaVersion != 13 {
		t.Fatalf("expected schema 13 manifest, got version=%d err=%v", manifest.SchemaVersion, err)
	}
}
