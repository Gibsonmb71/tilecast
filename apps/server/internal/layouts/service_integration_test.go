package layouts

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func TestLayoutDraftPublishAndRestoreLifecycle(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE layouts, sessions, audit_logs, users, organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}
	owner, err := auth.NewService(pool, time.Hour).Setup(ctx, auth.SetupInput{OrganizationName: "Layout Test", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(pool)
	layout, err := service.Create(ctx, owner.User.ID, "Lobby board", "", "landscape", 1920, 1080)
	if err != nil {
		t.Fatal(err)
	}
	document := validTestDocument()
	layout, err = service.SaveDraft(ctx, layout.ID, owner.User.ID, layout.DraftRevision, document)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SaveDraft(ctx, layout.ID, owner.User.ID, 1, document); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	published, err := service.Publish(ctx, layout.ID, owner.User.ID, layout.DraftRevision)
	if err != nil {
		t.Fatal(err)
	}
	if published.Revision != 1 || published.DocumentSHA256 == "" {
		t.Fatalf("published=%#v", published)
	}
	document.Placements[0].Primitive.Text = "Changed draft"
	layout, err = service.SaveDraft(ctx, layout.ID, owner.User.ID, layout.DraftRevision, document)
	if err != nil {
		t.Fatal(err)
	}
	immutable, err := service.GetRevision(ctx, layout.ID, published.ID)
	if err != nil {
		t.Fatal(err)
	}
	if immutable.Document.Placements[0].Primitive.Text != "Welcome" {
		t.Fatal("published revision was mutated")
	}
	layout, err = service.Restore(ctx, layout.ID, published.ID, owner.User.ID, layout.DraftRevision)
	if err != nil {
		t.Fatal(err)
	}
	if layout.Draft.Placements[0].Primitive.Text != "Welcome" {
		t.Fatal("revision was not restored as draft")
	}
}
