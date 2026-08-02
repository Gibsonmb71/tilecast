package playlists

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/layouts"
)

func insertReadinessImage(t *testing.T, f *capabilityFixture) (uuid.UUID, uuid.UUID) {
	t.Helper()
	assetID, variantID := uuid.New(), uuid.New()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by) VALUES($1,$2,'Readiness image','image','readiness.png','image/png',$3,100,1920,1080,'ready',$4)`, assetID, f.org, make([]byte, 32), f.user); err != nil {
		t.Fatalf("insert readiness asset: %v", err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible) VALUES($1,$2,'original','local',$3,'image/png',100,$4,1920,1080,TRUE)`, variantID, assetID, "originals/"+assetID.String(), make([]byte, 32)); err != nil {
		t.Fatalf("insert readiness variant: %v", err)
	}
	return assetID, variantID
}

func readinessImageLayout(assetID, variantID uuid.UUID) layouts.Document {
	return layouts.Document{
		SchemaVersion: 2,
		Canvas:        layouts.Canvas{Width: 1920, Height: 1080, Orientation: "landscape", BackgroundColor: "#0E141B"},
		Placements: []layouts.Placement{{
			ID: uuid.New(), Type: "asset", Name: "Readiness image", X: 0, Y: 0,
			Width: 1920, Height: 1080, Layer: 0, Opacity: 1, Visible: true,
			AssetID: &assetID, VariantID: &variantID,
		}},
	}
}

func TestSharedReadinessRejectsUnpublishedDeletedAndUnavailableLayoutItems(t *testing.T) {
	f := setupCapabilityFixture(t)
	layoutsService := layouts.NewService(f.pool)
	layoutsService.SetManifestInvalidator(f.service)

	unpublished, err := layoutsService.Create(f.ctx, f.user, "Unpublished layout", "", "landscape", 1920, 1080)
	if err != nil {
		t.Fatal(err)
	}
	unpublishedPlaylist, err := f.service.Create(f.ctx, f.user, "Unpublished layout playlist", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `INSERT INTO playlist_items(id,playlist_id,asset_id,layout_id,position,duration_ms) VALUES($1,$2,NULL,$3,0,10000)`, uuid.New(), unpublishedPlaylist.ID, unpublished.ID); err != nil {
		t.Fatal(err)
	}
	if err = f.service.ValidatePresentationNow(f.ctx, "playlist", unpublishedPlaylist.ID, time.Now().UTC()); !errors.Is(err, ErrPresentationNotReady) {
		t.Fatalf("unpublished layout item was accepted: %v", err)
	}

	assetID, variantID := insertReadinessImage(t, f)
	layout, err := layoutsService.Create(f.ctx, f.user, "Published layout", "", "landscape", 1920, 1080)
	if err != nil {
		t.Fatal(err)
	}
	layout, err = layoutsService.SaveDraft(f.ctx, layout.ID, f.user, layout.DraftRevision, readinessImageLayout(assetID, variantID))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = layoutsService.Publish(f.ctx, layout.ID, f.user, layout.DraftRevision); err != nil {
		t.Fatal(err)
	}
	playlist, err := f.service.Create(f.ctx, f.user, "Layout playlist", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	duration := int64(30_000)
	if _, err = f.service.AddItem(f.ctx, playlist.ID, f.user, ItemInput{LayoutID: &layout.ID, DurationMS: &duration, DeliveryPolicy: "stream"}); err != nil {
		t.Fatal(err)
	}
	if err = f.service.ValidatePresentationNow(f.ctx, "playlist", playlist.ID, time.Now().UTC()); err != nil {
		t.Fatalf("valid layout playlist rejected: %v", err)
	}

	if _, err = f.pool.Exec(f.ctx, `UPDATE assets SET processing_status='deleting' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `UPDATE assets SET processing_status='failed' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if err = f.service.ValidatePresentationNow(f.ctx, "playlist", playlist.ID, time.Now().UTC()); !errors.Is(err, ErrPresentationNotReady) {
		t.Fatalf("layout containing failed media was accepted: %v", err)
	}
	if _, err = f.pool.Exec(f.ctx, `UPDATE assets SET processing_status='queued' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `UPDATE assets SET processing_status='processing' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `UPDATE assets SET processing_status='ready' WHERE id=$1`, assetID); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `UPDATE layouts SET deleted_at=now() WHERE id=$1`, layout.ID); err != nil {
		t.Fatal(err)
	}
	if err = f.service.ValidatePresentationNow(f.ctx, "playlist", playlist.ID, time.Now().UTC()); !errors.Is(err, ErrPresentationNotReady) {
		t.Fatalf("playlist item referencing deleted layout was accepted: %v", err)
	}
}

func TestTakeoverManifestUsesSharedReadiness(t *testing.T) {
	f := setupCapabilityFixture(t)
	playlist, err := f.service.Create(f.ctx, f.user, "Presentable playlist", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	f.addReadyImageToPlaylist(t, playlist.ID)

	// Simulate the durable activation rows produced by the takeover activation
	// transaction, then exercise the same manifest reader used after a player
	// reconnect. A layout item cannot disappear behind a nil asset_id here.
	if _, err = f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); err != nil {
		t.Fatal(err)
	}
	takeoverID := uuid.New()
	now := time.Now().UTC()
	if _, err = f.pool.Exec(f.ctx, `INSERT INTO takeovers(id,organization_id,name,playlist_id,status,activated_at,expires_at) VALUES($1,$2,'Readiness takeover',$3,'active',$4,$5)`, takeoverID, f.org, playlist.ID, now, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var version int64
	if err = f.pool.QueryRow(f.ctx, `SELECT manifest_version FROM screen_manifest_state WHERE screen_id=$1`, f.screen).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `INSERT INTO takeover_targets(takeover_id,target_type,screen_id) VALUES($1,'screen',$2)`, takeoverID, f.screen); err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(f.ctx, `INSERT INTO takeover_screen_states(takeover_id,screen_id,manifest_version,state) VALUES($1,$2,$3,'pending')`, takeoverID, f.screen, version+1); err != nil {
		t.Fatal(err)
	}
	manifest, _, err := f.service.BuildManifest(f.ctx, f.screen)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Takeover == nil || manifest.Takeover.ID != takeoverID {
		t.Fatalf("active takeover was not projected into the player manifest: %#v", manifest.Takeover)
	}
}
