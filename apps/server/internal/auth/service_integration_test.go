package auth_test

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

func TestMigrationsAndAuthenticationLifecycle(t *testing.T) {
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
		t.Fatalf("apply migrations: %v", err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer pool.Close()

	if _, err := pool.Exec(ctx, "TRUNCATE sessions, audit_logs, users, organization_settings CASCADE"); err != nil {
		t.Fatalf("reset integration tables: %v", err)
	}
	var tableCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('organization_settings','users','sessions','audit_logs')`).Scan(&tableCount); err != nil {
		t.Fatalf("inspect migrated tables: %v", err)
	}
	if tableCount != 4 {
		t.Fatalf("expected four foundation tables, got %d", tableCount)
	}

	service := auth.NewService(pool, time.Hour)
	required, err := service.SetupRequired(ctx)
	if err != nil || !required {
		t.Fatalf("expected setup to be required: required=%v err=%v", required, err)
	}
	setup, err := service.Setup(ctx, auth.SetupInput{
		OrganizationName: "Integration Library",
		OwnerName:        "Integration Owner",
		Username:         "owner@example.org",
		Password:         "correct horse battery staple",
	})
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	if setup.User.Role != "owner" || setup.Token == "" || setup.CSRFToken == "" {
		t.Fatalf("unexpected setup session: %#v", setup)
	}
	if _, err := service.Setup(ctx, auth.SetupInput{OrganizationName: "Second Org", OwnerName: "Other Owner", Username: "other", Password: "another valid long password"}); !errors.Is(err, auth.ErrSetupComplete) {
		t.Fatalf("expected duplicate setup to fail, got %v", err)
	}
	if _, err := service.Authenticate(ctx, setup.Token); err != nil {
		t.Fatalf("authenticate setup session: %v", err)
	}
	if err := service.Logout(ctx, setup.Token, setup.User.ID); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if _, err := service.Authenticate(ctx, setup.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("expected revoked session to fail, got %v", err)
	}
	login, err := service.Login(ctx, auth.LoginInput{Username: "OWNER@example.org", Password: "correct horse battery staple"})
	if err != nil || login.User.ID != setup.User.ID {
		t.Fatalf("login after logout failed: session=%#v err=%v", login, err)
	}
}
