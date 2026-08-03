package presentations

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/layouts"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

func TestQuickPresentUsesSharedReadinessAndProjectsIntoManifest(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE presentation_overrides,takeover_screen_states,takeover_targets,takeovers,screen_manifest_state,screen_playlist_assignments,playlist_items,playlists,layout_revision_dependencies,layout_revisions,layouts,asset_variants,assets,screens,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Present Test", OwnerName: "Owner", Username: "present-owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	var organizationID uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	screenID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone) VALUES($1,$2,$3,'Present screen','android-tv','Test','TV','14','1',1920,1080,1,'en-US','UTC')`, screenID, organizationID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	assetID, variantID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by) VALUES($1,$2,'Present image','image','present.png','image/png',$3,100,1920,1080,'ready',$4)`, assetID, organizationID, make([]byte, 32), owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible) VALUES($1,$2,'original','local','originals/present','image/png',100,$3,1920,1080,TRUE)`, variantID, assetID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	playlistService := playlists.NewService(pool, nil)
	playlist, err := playlistService.Create(ctx, owner.User.ID, "Present playlist", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	duration := int64(10_000)
	if _, err = pool.Exec(ctx, `INSERT INTO playlist_items(id,playlist_id,asset_id,position,duration_ms) VALUES($1,$2,$3,0,$4)`, uuid.New(), playlist.ID, assetID, duration); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, nil)
	service.SetPresentationReadiness(playlistService)
	playlistService.SetPresentationOverrides(service)
	if _, err = service.Create(ctx, CreateInput{TargetType: "screen", TargetID: screenID, ContentType: "playlist", ContentID: playlist.ID, Duration: 5 * time.Minute, AfterAction: "resume", CreatedBy: owner.User.ID}); err != nil {
		t.Fatalf("ready Quick Present rejected: %v", err)
	}
	if _, err = playlistService.Assign(ctx, screenID, playlist.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	manifest, _, err := playlistService.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.PresentationOverride == nil || manifest.PresentationOverride.ContentID != playlist.ID || manifest.Playlist == nil {
		t.Fatalf("Quick Present was not projected into the player manifest: override=%#v playlist=%#v", manifest.PresentationOverride, manifest.Playlist)
	}
	if _, err = pool.Exec(ctx, `UPDATE assets SET available_from=now()+interval '1 hour' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Create(ctx, CreateInput{TargetType: "screen", TargetID: screenID, ContentType: "playlist", ContentID: playlist.ID, Duration: 5 * time.Minute, AfterAction: "resume", CreatedBy: owner.User.ID}); !errors.Is(err, playlists.ErrPresentationNotReady) {
		t.Fatalf("future-only Quick Present returned %v, want shared readiness failure", err)
	}
	// A website/widget can be structurally valid while its only fallback image
	// is outside its window. Strict-now validation must follow that alternate
	// path even when the widget is presented as the root content type.
	fallbackID, fallbackVariantID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by) VALUES($1,$2,'Future website fallback','image','fallback.png','image/png',$3,100,1920,1080,'ready',$4)`, fallbackID, organizationID, make([]byte, 32), owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible) VALUES($1,$2,'original','local',$3,'image/png',100,$4,1920,1080,TRUE)`, fallbackVariantID, fallbackID, "originals/"+fallbackID.String(), make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	websiteID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,processing_status,created_by) VALUES($1,$2,'Present website','widget','','application/vnd.tilecast.widget+json',$3,0,'ready',$4)`, websiteID, organizationID, make([]byte, 32), owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO website_assets(asset_id,url,display_url,allowed_hosts,failure_behavior,fallback_image_asset_id) VALUES($1,'https://example.com/present','https://example.com/present',ARRAY['example.com'],'fallback_image',$2)`, websiteID, fallbackID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO widgets(asset_id,provider,configuration) VALUES($1,'website',jsonb_build_object('url','https://example.com/present'))`, websiteID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE assets SET available_from=now()+interval '1 hour' WHERE id=$1`, fallbackID); err != nil {
		t.Fatal(err)
	}
	if err = playlistService.ValidatePresentationNow(ctx, "asset", websiteID, time.Now().UTC()); !errors.Is(err, playlists.ErrPresentationNotReady) {
		t.Fatalf("widget with future-only fallback returned %v, want shared readiness failure", err)
	}

	layoutService := layouts.NewService(pool)
	unpublished, err := layoutService.Create(ctx, owner.User.ID, "Unpublished present layout", "", "landscape", 1920, 1080)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Create(ctx, CreateInput{TargetType: "screen", TargetID: screenID, ContentType: "layout", ContentID: unpublished.ID, Duration: 5 * time.Minute, AfterAction: "resume", CreatedBy: owner.User.ID}); !errors.Is(err, playlists.ErrPresentationNotReady) {
		t.Fatalf("unpublished Quick Present returned %v, want shared readiness failure", err)
	}
}
