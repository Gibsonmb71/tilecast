package playlists

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
)

func TestSyncGroupRemovalRestoresScreenContent(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE screen_group_membership_schedule_snapshots,screen_group_membership_snapshots,schedule_targets,schedules,screen_group_playlist_assignments,screen_group_memberships,screen_groups,screen_player_status,screen_manifest_state,screen_playlist_assignments,playlist_items,playlists,asset_variants,assets,screens,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Sync Restore Test", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT id FROM organization_settings`).Scan(&org); err != nil {
		t.Fatal(err)
	}
	lobbyScreen, hallScreen := uuid.New(), uuid.New()
	for _, screen := range []uuid.UUID{lobbyScreen, hallScreen} {
		if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone)VALUES($1,$2,$3,'Screen','android-tv','Google','ADT-3','14','0.4.0',1920,1080,2,'en-US','UTC')`, screen, org, uuid.NewString()); err != nil {
			t.Fatal(err)
		}
	}
	imageID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by)VALUES($1,$2,'Welcome','image','welcome.png','image/png',$3,100,1920,1080,'ready',$4)`, imageID, org, make([]byte, 32), owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible)VALUES($1,$2,'original','local','originals/image','image/png',100,$3,1920,1080,TRUE)`, uuid.New(), imageID, make([]byte, 32)); err != nil {
		t.Fatal(err)
	}
	service := NewService(pool, &testNotifier{})
	duration := int64(10_000)
	lobbyPlaylist, err := service.Create(ctx, owner.User.ID, "Lobby loop", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.AddItem(ctx, lobbyPlaylist.ID, owner.User.ID, ItemInput{AssetID: imageID, DurationMS: &duration}); err != nil {
		t.Fatal(err)
	}
	publishDraftForTest(t, ctx, service, lobbyPlaylist.ID, owner.User.ID)
	groupPlaylist, err := service.Create(ctx, owner.User.ID, "Group loop", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.AddItem(ctx, groupPlaylist.ID, owner.User.ID, ItemInput{AssetID: imageID, DurationMS: &duration}); err != nil {
		t.Fatal(err)
	}
	publishDraftForTest(t, ctx, service, groupPlaylist.ID, owner.User.ID)
	if _, err = service.Assign(ctx, lobbyScreen, lobbyPlaylist.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Assign(ctx, hallScreen, groupPlaylist.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	scheduler := scheduling.NewService(pool, &testNotifier{}, scheduling.Limits{MaxSchedules: 1000, MaxTargetsPerSchedule: 250, MaxGroupsPerScreen: 50, PrefetchDays: 14, ActivationGraceSeconds: 30, ClockSkewWarningSeconds: 300})
	service.SetScheduling(scheduler)
	start, end := time.Now().Add(-time.Hour), time.Now().Add(time.Hour)
	scheduled, err := scheduler.Create(ctx, owner.User.ID, scheduling.Input{Name: "Lobby event", PlaylistID: lobbyPlaylist.ID, Type: scheduling.OneTime, Timezone: "America/New_York", Priority: 500, Enabled: true, OneTimeStart: &start, OneTimeEnd: &end, Targets: []scheduling.Target{{Type: "screen", ID: lobbyScreen}}})
	if err != nil {
		t.Fatal(err)
	}
	group, err := scheduler.CreateGroup(ctx, owner.User.ID, "Front of house", "")
	if err != nil {
		t.Fatal(err)
	}
	// The first member's playlist becomes the group playlist; the second
	// member keeps playing the group content while it is a member.
	if err = scheduler.AddScreen(ctx, group.ID, hallScreen, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if err = scheduler.AddScreen(ctx, group.ID, lobbyScreen, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	grouped, err := service.Assignment(ctx, lobbyScreen)
	if err != nil || grouped.PlaylistID == nil || *grouped.PlaylistID != groupPlaylist.ID {
		t.Fatalf("grouped assignment=%#v %v", grouped, err)
	}
	if err = scheduler.RemoveScreen(ctx, group.ID, lobbyScreen, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	restored, err := service.Assignment(ctx, lobbyScreen)
	if err != nil || restored.PlaylistID == nil || *restored.PlaylistID != lobbyPlaylist.ID {
		t.Fatalf("removed screen did not revert to its own playlist: %#v %v", restored, err)
	}
	var scheduleTargets int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM schedule_targets WHERE schedule_id=$1 AND target_type='screen' AND screen_id=$2`, scheduled.ID, lobbyScreen).Scan(&scheduleTargets); err != nil {
		t.Fatal(err)
	}
	if scheduleTargets != 1 {
		t.Fatalf("removed screen schedule target was not restored: %d", scheduleTargets)
	}
	var snapshots int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM screen_group_membership_snapshots WHERE screen_id=$1`, lobbyScreen).Scan(&snapshots); err != nil {
		t.Fatal(err)
	}
	if snapshots != 0 {
		t.Fatalf("snapshot was not cleaned up after removal: %d", snapshots)
	}
	if err = scheduler.DeleteGroup(ctx, group.ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	hallRestored, err := service.Assignment(ctx, hallScreen)
	if err != nil || hallRestored.PlaylistID == nil || *hallRestored.PlaylistID != groupPlaylist.ID {
		t.Fatalf("group deletion did not restore member playlist: %#v %v", hallRestored, err)
	}
}
