package playlists

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
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
)

type testNotifier struct{ versions []int64 }

func (n *testNotifier) ManifestChanged(_ uuid.UUID, version int64) {
	n.versions = append(n.versions, version)
}

func TestPlaylistAssignmentManifestLifecycle(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE screen_player_status,screen_manifest_state,screen_playlist_assignments,playlist_items,playlists,media_jobs,upload_sessions,asset_variants,assets,device_pairing_sessions,device_credentials,screens,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Playlist Test", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT id FROM organization_settings`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	screenID := uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone)VALUES($1,$2,$3,'Lobby','android-tv','Google','ADT-3','14','0.4.0',1920,1080,2,'en-US','UTC')`, screenID, org, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	imageID, videoID := uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,duration_seconds,processing_status,created_by)VALUES($1,$3,'Welcome','image','welcome.png','image/png',$4,100,1920,1080,NULL,'ready',$5),($2,$3,'Announcement','video','announcement.mp4','video/mp4',$4,1000,1920,1080,12.5,'ready',$5)`, imageID, videoID, org, make([]byte, 32), owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	imageVariant, videoVariant := uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,duration_seconds,player_compatible)VALUES($1,$3,'original','local',$5,'image/png',100,$7,1920,1080,NULL,TRUE),($2,$4,'playback','local',$6,'video/mp4',1000,$7,1920,1080,12.5,TRUE)`, imageVariant, videoVariant, imageID, videoID, "originals/image", "variants/video", make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	notifier := &testNotifier{}
	service := NewService(pool, notifier)
	playlist, err := service.Create(ctx, owner.User.ID, "Morning announcements", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.AddItem(ctx, playlist.ID, owner.User.ID, ItemInput{AssetID: imageID}); err == nil {
		t.Fatal("image without duration was accepted")
	}
	duration := int64(10_000)
	playlist, err = service.AddItem(ctx, playlist.ID, owner.User.ID, ItemInput{AssetID: imageID, DurationMS: &duration})
	if err != nil {
		t.Fatal(err)
	}
	playlist, err = service.AddItem(ctx, playlist.ID, owner.User.ID, ItemInput{AssetID: videoID})
	if err != nil {
		t.Fatal(err)
	}
	if len(playlist.Items) != 2 || playlist.Revision != 3 {
		t.Fatalf("playlist=%#v", playlist)
	}
	playlist, err = service.Reorder(ctx, playlist.ID, owner.User.ID, []uuid.UUID{playlist.Items[1].ID, playlist.Items[0].ID})
	if err != nil || playlist.Items[0].AssetID != videoID {
		t.Fatalf("reorder: %#v %v", playlist, err)
	}
	assignment, err := service.Assign(ctx, screenID, playlist.ID, owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	manifest, etag, err := service.BuildManifest(ctx, screenID)
	if err != nil {
		t.Fatal(err)
	}
	same, sameETag, err := service.BuildManifest(ctx, screenID)
	if err != nil || same.ManifestVersion != manifest.ManifestVersion || sameETag != etag {
		t.Fatal("manifest read changed version or ETag")
	}
	if manifest.SchemaVersion != 6 || manifest.DirectFallbackPlaylist == nil || len(manifest.DirectFallbackPlaylist.Items) != 2 || len(manifest.Assets) != 2 {
		t.Fatalf("manifest=%#v", manifest)
	}
	emergencyID := uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO emergency_takeovers(id,organization_id,name,playlist_id,status,activated_by,activated_at,expires_at)VALUES($1,$2,'Test emergency',$3,'active',$4,now(),now()+interval '1 hour')`, emergencyID, org, playlist.ID, owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO emergency_targets(emergency_id,target_type,screen_id)VALUES($1,'screen',$2)`, emergencyID, screenID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO emergency_screen_states(emergency_id,screen_id,manifest_version,state)VALUES($1,$2,$3,'pending')`, emergencyID, screenID, manifest.ManifestVersion); err != nil {
		t.Fatal(err)
	}
	emergencyManifest, _, err := service.BuildManifest(ctx, screenID)
	if err != nil || emergencyManifest.Emergency == nil || emergencyManifest.Emergency.ID != emergencyID || emergencyManifest.Emergency.PlaylistID != playlist.ID {
		t.Fatalf("emergency manifest=%#v err=%v", emergencyManifest.Emergency, err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM emergency_takeovers WHERE id=$1`, emergencyID); err != nil {
		t.Fatal(err)
	}
	scheduler := scheduling.NewService(pool, notifier, scheduling.Limits{MaxSchedules: 1000, MaxTargetsPerSchedule: 250, MaxGroupsPerScreen: 50, PrefetchDays: 14, ActivationGraceSeconds: 30, ClockSkewWarningSeconds: 300})
	service.SetScheduling(scheduler)
	group, err := scheduler.CreateGroup(ctx, owner.User.ID, "Lobby screens", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = scheduler.AddScreen(ctx, group.ID, screenID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	otherGroup, err := scheduler.CreateGroup(ctx, owner.User.ID, "Other screens", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = scheduler.AddScreen(ctx, otherGroup.ID, screenID, owner.User.ID); !errors.Is(err, scheduling.ErrConflict) {
		t.Fatalf("screen joined a second sync group: %v", err)
	}
	start, end := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)
	scheduled, err := scheduler.Create(ctx, owner.User.ID, scheduling.Input{Name: "Special event", PlaylistID: playlist.ID, Type: scheduling.OneTime, Timezone: "America/New_York", Priority: 500, Enabled: true, OneTimeStart: &start, OneTimeEnd: &end, Targets: []scheduling.Target{{Type: "screen", ID: screenID}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(scheduled.Targets) != 1 || scheduled.Targets[0].Type != "group" || scheduled.Targets[0].ID != group.ID {
		t.Fatalf("grouped screen target was not normalized: %#v", scheduled.Targets)
	}
	scheduledManifest, _, err := service.BuildManifest(ctx, screenID)
	if err != nil || len(scheduledManifest.Schedules) != 1 || len(scheduledManifest.Playlists) != 1 || scheduledManifest.SyncGroup == nil || scheduledManifest.SyncGroup.ID != group.ID {
		t.Fatalf("scheduled manifest=%#v %v", scheduledManifest, err)
	}
	updatedInput := ItemInput{AssetID: videoID, DeliveryPolicy: "stream"}
	playlist, err = service.UpdateItem(ctx, playlist.ID, playlist.Items[0].ID, owner.User.ID, updatedInput)
	if err != nil {
		t.Fatal(err)
	}
	changed, _, err := service.BuildManifest(ctx, screenID)
	if err != nil || changed.ManifestVersion <= manifest.ManifestVersion {
		t.Fatal("playlist update did not advance manifest")
	}
	active := changed.ManifestVersion
	status := PlayerStatus{ActiveManifestVersion: &active, PlaybackState: "playing"}
	if err = service.ReportStatus(ctx, screenID, status); err != nil {
		t.Fatal(err)
	}
	assignment, err = service.Assignment(ctx, screenID)
	if err != nil || assignment.SynchronizationStatus != "current" {
		t.Fatalf("assignment=%#v %v", assignment, err)
	}
	if err = service.Delete(ctx, playlist.ID, owner.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("assigned playlist deletion=%v", err)
	}
	noAssignment, err := service.Unassign(ctx, screenID, owner.User.ID)
	if err != nil || noAssignment.PlaylistID != nil {
		t.Fatalf("unassign=%#v %v", noAssignment, err)
	}
	if err = scheduler.Delete(ctx, scheduled.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	empty, _, err := service.BuildManifest(ctx, screenID)
	if err != nil || empty.DirectFallbackPlaylist != nil {
		t.Fatalf("empty manifest=%#v %v", empty, err)
	}
	websiteID := uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,processing_status,created_by)VALUES($1,$2,'Status website','source','','application/vnd.tilecast.source+json',''::bytea,0,'ready',$3)`, websiteID, org, owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO website_assets(asset_id,url,display_url,allowed_hosts,failure_behavior,fallback_image_asset_id)VALUES($1,'https://example.com/status','https://example.com/status',ARRAY['example.com'],'fallback_image',$2)`, websiteID, imageID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO sources(asset_id,provider,configuration)VALUES($1,'website',jsonb_build_object('url','https://example.com/status','displayUrl','https://example.com/status','allowedHosts',jsonb_build_array('example.com'),'javascriptEnabled',true,'domStorageEnabled',true,'cookiePolicy','first_party','reloadPolicy','on_each_activation','loadTimeoutSeconds',20,'zoomPercent',100,'scrollX',0,'scrollY',0,'customUserAgent','','backgroundColor','#0E141B','failureBehavior','fallback_image','fallbackImageAssetId',$2::text))`, websiteID, imageID)
	if err != nil {
		t.Fatal(err)
	}
	webPlaylist, err := service.Create(ctx, owner.User.ID, "Web status", "")
	if err != nil {
		t.Fatal(err)
	}
	webDuration := int64(30000)
	webPlaylist, err = service.AddItem(ctx, webPlaylist.ID, owner.User.ID, ItemInput{AssetID: websiteID, DurationMS: &webDuration, DeliveryPolicy: "stream"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.Assign(ctx, screenID, webPlaylist.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	webManifest, _, err := service.BuildManifest(ctx, screenID)
	if err != nil || webManifest.SchemaVersion != 6 || len(webManifest.Sources) != 1 || webManifest.Sources[0].Provider != "website" || len(webManifest.Assets) != 1 {
		t.Fatalf("website manifest=%#v %v", webManifest, err)
	}
	if len(notifier.versions) < 3 {
		t.Fatalf("notifications=%v", notifier.versions)
	}
}
