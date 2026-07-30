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
)

// Exercises the revision snapshot and restore against a real PostgreSQL server.
// The snapshot builds its items array with a correlated jsonb_agg, and restore
// has to skip content that has since been deleted, neither of which a unit test
// can confirm.
func TestPlaylistRevisionSnapshotAndRestore(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE playlist_revisions,playlist_items,playlists,asset_variants,assets,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{
		OrganizationName: "Revision Test", OwnerName: "Owner",
		Username: "owner", Password: "correct horse battery staple",
	})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT id FROM organization_settings`).Scan(&org); err != nil {
		t.Fatal(err)
	}

	keptID, doomedID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `
		INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,
			sha256,original_size,width,height,processing_status,created_by)
		VALUES($1,$3,'Kept','image','kept.png','image/png',$4,100,1920,1080,'ready',$5),
		      ($2,$3,'Doomed','image','doomed.png','image/png',$4,100,1920,1080,'ready',$5)`,
		keptID, doomedID, org, make([]byte, 32), owner.User.ID); err != nil {
		t.Fatal(err)
	}
	for _, asset := range []uuid.UUID{keptID, doomedID} {
		if _, err = pool.Exec(ctx, `
			INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,
				mime_type,file_size,sha256,width,height,duration_seconds,player_compatible)
			VALUES($1,$2,'playback','local',$3,'image/png',100,$4,1920,1080,NULL,TRUE)`,
			uuid.New(), asset, "variants/"+asset.String(), make([]byte, 32)); err != nil {
			t.Fatal(err)
		}
	}

	service := NewService(pool, &testNotifier{})
	playlist, err := service.Create(ctx, owner.User.ID, "Menu", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	duration := int64(8000)
	for _, asset := range []uuid.UUID{keptID, doomedID} {
		if _, err = service.AddItem(ctx, playlist.ID, owner.User.ID, ItemInput{
			AssetID: asset, DurationMS: &duration,
		}); err != nil {
			t.Fatalf("add item: %v", err)
		}
	}

	// The snapshot must actually have been written by the mutation path, with
	// its items array populated. This is the query a unit test cannot reach.
	var rows, withItems int
	if err = pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE jsonb_array_length(items) > 0)
		FROM playlist_revisions WHERE playlist_id=$1`, playlist.ID).Scan(&rows, &withItems); err != nil {
		t.Fatal(err)
	}
	if rows == 0 {
		t.Fatal("no revision was recorded by the mutation path")
	}
	if withItems == 0 {
		t.Fatal("every recorded revision has an empty items array")
	}
	t.Logf("revisions recorded: %d, of which %d carry items", rows, withItems)

	twoItems, err := service.Get(ctx, playlist.ID)
	if err != nil {
		t.Fatal(err)
	}
	target := twoItems.Revision
	if len(twoItems.Items) != 2 {
		t.Fatalf("playlist has %d items, want 2", len(twoItems.Items))
	}

	// Remove an item so the target revision is genuinely different, then delete
	// one asset so the restore has to skip it.
	if _, err = service.DeleteItem(ctx, playlist.ID, twoItems.Items[1].ID, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE assets SET deleted_at=now() WHERE id=$1`, doomedID); err != nil {
		t.Fatal(err)
	}

	history, err := service.ListRevisions(ctx, playlist.ID)
	if err != nil {
		t.Fatalf("list revisions: %v", err)
	}
	var found bool
	for _, item := range history {
		if item.Revision == target {
			found = true
			if item.MissingRefs != 1 {
				t.Errorf("revision %d reports %d missing references, want 1", target, item.MissingRefs)
			}
		}
	}
	if !found {
		t.Fatalf("revision %d is not in the history", target)
	}

	result, err := service.RestoreRevision(ctx, playlist.ID, target, owner.User.ID)
	if err != nil {
		t.Fatalf("restore: %v", err)
	}
	if result.SkippedItems != 1 {
		t.Errorf("skipped %d items, want 1 for the deleted asset", result.SkippedItems)
	}
	if result.NewRevision <= target {
		t.Errorf("restore produced revision %d, which is not newer than %d", result.NewRevision, target)
	}
	if len(result.Playlist.Items) != 1 {
		t.Errorf("restored playlist has %d items, want 1", len(result.Playlist.Items))
	}
	t.Logf("restored revision %d as %d, skipping %d deleted item(s)",
		result.RestoredFrom, result.NewRevision, result.SkippedItems)
}
