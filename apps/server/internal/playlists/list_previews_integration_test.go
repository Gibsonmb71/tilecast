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

func TestListPreviewItemsIntegration(t *testing.T) {
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
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{
		OrganizationName: "Playlist Preview Test",
		OwnerName:        "Owner",
		Username:         "owner",
		Password:         "correct horse battery staple",
	})
	if err != nil {
		t.Fatal(err)
	}
	var org uuid.UUID
	if err = pool.QueryRow(ctx, `SELECT id FROM organization_settings`).Scan(&org); err != nil {
		t.Fatal(err)
	}

	firstID, secondID, taggedID := uuid.New(), uuid.New(), uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO assets(id,organization_id,name,type,original_filename,detected_mime_type,sha256,original_size,width,height,processing_status,created_by)
		VALUES
			($1,$4,'First slide','image','first.png','image/png',$5,100,1920,1080,'ready',$6),
			($2,$4,'Second slide','image','second.png','image/png',$5,100,1920,1080,'ready',$6),
			($3,$4,'Tagged notice','image','tagged.png','image/png',$5,100,1920,1080,'ready',$6)`,
		firstID, secondID, taggedID, org, make([]byte, 32), owner.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO asset_variants(id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256,width,height,player_compatible)
		VALUES
			($1,$4,'original','local','originals/first','image/png',100,$7,1920,1080,TRUE),
			($2,$5,'original','local','originals/second','image/png',100,$7,1920,1080,TRUE),
			($3,$6,'original','local','originals/tagged','image/png',100,$7,1920,1080,TRUE)`,
		uuid.New(), uuid.New(), uuid.New(), firstID, secondID, taggedID, make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}

	service := NewService(pool, &testNotifier{})
	staticPlaylist, err := service.Create(ctx, owner.User.ID, "Static playlist", "", "static")
	if err != nil {
		t.Fatal(err)
	}
	duration := int64(10_000)
	staticPlaylist, err = service.AddItem(ctx, staticPlaylist.ID, owner.User.ID, ItemInput{AssetID: secondID, DurationMS: &duration})
	if err != nil {
		t.Fatal(err)
	}
	staticPlaylist, err = service.AddItem(ctx, staticPlaylist.ID, owner.User.ID, ItemInput{AssetID: firstID, DurationMS: &duration})
	if err != nil {
		t.Fatal(err)
	}

	tagID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO content_tags(id,organization_id,name,color,created_by)VALUES($1,$2,'Notices','#2563eb',$3)`, tagID, org, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO content_asset_tags(asset_id,tag_id)VALUES($1,$2)`, taggedID, tagID); err != nil {
		t.Fatal(err)
	}
	tagPlaylist, err := service.Create(ctx, owner.User.ID, "Tag playlist", "", "tag")
	if err != nil {
		t.Fatal(err)
	}
	tagPlaylist, err = service.SetTagRule(ctx, tagPlaylist.ID, owner.User.ID, TagRuleInput{
		Enabled:         true,
		Match:           "any",
		ImageDurationMS: 10_000,
		TagIDs:          []uuid.UUID{tagID},
	})
	if err != nil {
		t.Fatal(err)
	}

	previews, err := service.ListPreviewItems(ctx, []uuid.UUID{staticPlaylist.ID, tagPlaylist.ID})
	if err != nil {
		t.Fatal(err)
	}
	staticPreviews := previews[staticPlaylist.ID]
	if len(staticPreviews) != 2 {
		t.Fatalf("static previews=%#v", staticPreviews)
	}
	if staticPreviews[0].Name != "Second slide" || staticPreviews[1].Name != "First slide" {
		t.Fatalf("static preview order=%#v", staticPreviews)
	}
	if staticPreviews[0].ThumbnailURL != "/api/v1/assets/"+secondID.String()+"/thumbnail" {
		t.Fatalf("static preview URL=%q", staticPreviews[0].ThumbnailURL)
	}
	tagPreviews := previews[tagPlaylist.ID]
	if len(tagPreviews) != 1 || tagPreviews[0].Name != "Tagged notice" {
		t.Fatalf("tag previews=%#v", tagPreviews)
	}
	if tagPreviews[0].ThumbnailURL != "/api/v1/assets/"+taggedID.String()+"/thumbnail" {
		t.Fatalf("tag preview URL=%q", tagPreviews[0].ThumbnailURL)
	}
}
