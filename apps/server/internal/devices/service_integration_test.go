package devices

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func TestCompletePairingCredentialAndRevocationFlow(t *testing.T) {
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
		t.Fatalf("migrate: %v", err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `TRUNCATE device_pairing_sessions,device_credentials,screens,sessions,audit_logs,users,organization_settings CASCADE`); err != nil {
		t.Fatal(err)
	}

	authService := auth.NewService(pool, time.Hour)
	owner, err := authService.Setup(ctx, auth.SetupInput{OrganizationName: "Pairing Library", OwnerName: "Owner", Username: "owner", Password: "correct horse battery staple"})
	if err != nil {
		t.Fatal(err)
	}
	presence := NewPresenceHub()
	service := NewService(pool, presence, "https://signage.example.org")
	identity, err := service.Identity(ctx)
	if err != nil || identity.InstallationID == "" || identity.OrganizationName != "Pairing Library" {
		t.Fatalf("identity: %#v %v", identity, err)
	}
	metadata := DeviceMetadata{
		PlayerInstallationID: uuid.NewString(), Platform: "android-tv", Manufacturer: "Google", Model: "ADT-3",
		AndroidVersion: "14", PlayerVersion: "0.2.0", ScreenWidth: 1920, ScreenHeight: 1080, Density: 2,
		Locale: "en-US", Timezone: "America/New_York", ApproximateAddress: "192.168.1.42",
	}
	if _, err := service.CreatePairing(ctx, "wrong-installation", metadata); !errors.Is(err, ErrWrongInstallation) {
		t.Fatalf("expected installation mismatch, got %v", err)
	}
	pairing, err := service.CreatePairing(ctx, identity.InstallationID, metadata)
	if err != nil {
		t.Fatal(err)
	}
	if pairing.ServerTime.IsZero() || pairing.ExpiresAt.Sub(pairing.ServerTime) != PairingLifetime {
		t.Fatalf("pairing clock data is invalid: %#v", pairing)
	}
	resolved, err := service.ResolvePairing(ctx, pairing.Code)
	if err != nil || resolved.ID != pairing.ID || resolved.Metadata.Model != metadata.Model {
		t.Fatalf("resolve: %#v %v", resolved, err)
	}
	if _, err := service.PollPairing(ctx, pairing.ID, "wrong-secret"); !errors.Is(err, ErrWrongSecret) {
		t.Fatalf("expected wrong poll secret, got %v", err)
	}
	screen, err := service.ApprovePairing(ctx, pairing.ID, owner.User.ID, "Lobby display", "Main lobby", "Welcome screen")
	if err != nil {
		t.Fatal(err)
	}
	claim, err := service.PollPairing(ctx, pairing.ID, pairing.PollSecret)
	if err != nil || claim.Status != "claimed" || claim.EnrollmentToken == "" {
		t.Fatalf("claim: %#v %v", claim, err)
	}
	secondPoll, err := service.PollPairing(ctx, pairing.ID, pairing.PollSecret)
	if err != nil || secondPoll.EnrollmentToken != "" {
		t.Fatalf("poll secret returned token twice: %#v %v", secondPoll, err)
	}
	enrollment, err := service.Enroll(ctx, pairing.ID, claim.EnrollmentToken)
	if err != nil || enrollment.ScreenID != screen.ID || enrollment.DeviceCredential == "" {
		t.Fatalf("enroll: %#v %v", enrollment, err)
	}
	if _, err := service.Enroll(ctx, pairing.ID, claim.EnrollmentToken); !errors.Is(err, ErrAlreadyClaimed) {
		t.Fatalf("expected duplicate enrollment rejection, got %v", err)
	}
	principal, err := service.AuthenticateDevice(ctx, enrollment.DeviceCredential)
	if err != nil || principal.ScreenID != screen.ID {
		t.Fatalf("authenticate: %#v %v", principal, err)
	}
	storage := int64(4_000_000_000)
	uptime := int64(600)
	if err := service.Heartbeat(ctx, principal, Heartbeat{ScreenWidth: 1920, ScreenHeight: 1080, AvailableStorageBytes: &storage, UptimeSeconds: &uptime, PlayerVersion: "0.2.0"}, "192.168.1.42:1234"); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(ctx, screen.ID, owner.User.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateDevice(ctx, enrollment.DeviceCredential); !errors.Is(err, ErrDisabledScreen) {
		t.Fatalf("expected disabled screen rejection, got %v", err)
	}
	if err := service.SetEnabled(ctx, screen.ID, owner.User.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := service.Revoke(ctx, screen.ID, owner.User.ID, "integration test"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateDevice(ctx, enrollment.DeviceCredential); !errors.Is(err, ErrRevokedCredential) {
		t.Fatalf("expected revoked credential rejection, got %v", err)
	}

	rejected, err := service.CreatePairing(ctx, identity.InstallationID, withNewPlayerID(metadata))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RejectPairing(ctx, rejected.ID, owner.User.ID, "Unknown device"); err != nil {
		t.Fatal(err)
	}
	rejectedResult, err := service.PollPairing(ctx, rejected.ID, rejected.PollSecret)
	if err != nil || rejectedResult.Status != "rejected" {
		t.Fatalf("rejected result: %#v %v", rejectedResult, err)
	}

	expired, err := service.CreatePairing(ctx, identity.InstallationID, withNewPlayerID(metadata))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE device_pairing_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1`, expired.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ResolvePairing(ctx, expired.Code); !errors.Is(err, ErrExpired) {
		t.Fatalf("expected expired resolution, got %v", err)
	}
	expiredResult, err := service.PollPairing(ctx, expired.ID, expired.PollSecret)
	if err != nil || expiredResult.Status != "expired" {
		t.Fatalf("expired poll: %#v %v", expiredResult, err)
	}

	encoded, _ := json.Marshal(metadata)
	_, err = pool.Exec(ctx, `INSERT INTO device_pairing_sessions (id,code_hash,poll_secret_hash,requested_metadata,requested_server_installation_id,player_installation_id,status,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',now()+interval '10 minutes')`, uuid.New(), secretHash(pairing.Code), secretHash("another-poll-secret"), encoded, identity.InstallationID, uuid.NewString())
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "23505" {
		t.Fatalf("expected duplicate code constraint, got %v", err)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE action IN ('screen.pairing.approved','screen.pairing.rejected','screen.disabled','screen.enabled','screen.credential.revoked')`).Scan(&auditCount); err != nil || auditCount != 5 {
		t.Fatalf("audit count=%d err=%v", auditCount, err)
	}
}

func withNewPlayerID(metadata DeviceMetadata) DeviceMetadata {
	metadata.PlayerInstallationID = uuid.NewString()
	return metadata
}
