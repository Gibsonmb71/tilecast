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

// TestMultiFactorLifecycle exercises the full second-factor path against a real
// database: enrollment, the challenge that replaces a session, code reuse,
// recovery codes, the policy gate, and administrative reset.
func TestMultiFactorLifecycle(t *testing.T) {
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

	service := auth.NewService(pool, time.Hour)
	const password = "correct horse battery staple"
	setup, err := service.Setup(ctx, auth.SetupInput{
		OrganizationName: "Integration Library",
		OwnerName:        "Integration Owner",
		Username:         "owner@example.org",
		Password:         password,
	})
	if err != nil {
		t.Fatalf("create owner: %v", err)
	}
	owner := setup.User

	factors, err := service.Factors(ctx, owner.ID)
	if err != nil || factors.Enrolled {
		t.Fatalf("expected a new account to have no factors: %#v err=%v", factors, err)
	}

	uri, secret, err := service.BeginTOTPEnrollment(ctx, owner.ID, "Integration Library", owner.Username)
	if err != nil {
		t.Fatalf("begin enrollment: %v", err)
	}
	if uri == "" || secret == "" {
		t.Fatal("expected a provisioning uri and a typed secret")
	}
	// An unconfirmed enrollment must not gate sign-in, or an abandoned setup
	// would lock the account.
	if result, err := service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyNone); err != nil || result.Challenge != nil {
		t.Fatalf("unconfirmed enrollment must not challenge: %#v err=%v", result, err)
	}

	if err := service.ConfirmTOTPEnrollment(ctx, owner.ID, "000000"); !errors.Is(err, auth.ErrInvalidCode) {
		t.Fatalf("expected a wrong code to be refused, got %v", err)
	}
	code := auth.TestingTOTPCode(t, secret, time.Now())
	if err := service.ConfirmTOTPEnrollment(ctx, owner.ID, code); err != nil {
		t.Fatalf("confirm enrollment: %v", err)
	}

	result, err := service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyNone)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if result.Session != nil {
		t.Fatal("an enrolled account must not receive a session from a password alone")
	}
	if result.Challenge == nil {
		t.Fatal("expected a challenge")
	}
	challenge := result.Challenge.Token

	// The confirmation already consumed the current step, so the same code
	// must not also complete a sign-in.
	if _, err := service.CompleteChallenge(ctx, challenge, code, auth.MFAPolicyNone); !errors.Is(err, auth.ErrInvalidCode) {
		t.Fatalf("expected the replayed code to be refused, got %v", err)
	}
	next := auth.TestingTOTPCode(t, secret, time.Now().Add(30*time.Second))
	session, err := service.CompleteChallenge(ctx, challenge, next, auth.MFAPolicyNone)
	if err != nil {
		t.Fatalf("complete challenge: %v", err)
	}
	if session.AuthMethod != "totp" || session.Token == "" {
		t.Fatalf("unexpected session: %#v", session)
	}
	// A challenge is single use.
	if _, err := service.CompleteChallenge(ctx, challenge, next, auth.MFAPolicyNone); !errors.Is(err, auth.ErrInvalidChallenge) {
		t.Fatalf("expected a spent challenge to be refused, got %v", err)
	}

	// An account whose only usable factor cannot run on this installation must
	// be told so, not handed a challenge with no method it can present.
	if _, err := pool.Exec(ctx, `DELETE FROM user_totp_factors WHERE user_id=$1`, owner.ID); err != nil {
		t.Fatalf("clear authenticator: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO user_passkeys (id,user_id,credential_id,credential,name) VALUES (gen_random_uuid(),$1,'\x01','{}'::jsonb,'Test key')`, owner.ID); err != nil {
		t.Fatalf("insert passkey: %v", err)
	}
	if _, err := service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyNone); !errors.Is(err, auth.ErrNoUsableFactor) {
		t.Fatalf("expected a dead-end challenge to be refused, got %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM user_passkeys WHERE user_id=$1`, owner.ID); err != nil {
		t.Fatalf("clear passkey: %v", err)
	}
	// Re-enrolling mints a fresh secret, so the rest of the test uses that one.
	_, secret, err = service.BeginTOTPEnrollment(ctx, owner.ID, "Integration Library", owner.Username)
	if err != nil {
		t.Fatalf("re-enroll authenticator: %v", err)
	}
	if err := service.ConfirmTOTPEnrollment(ctx, owner.ID, auth.TestingTOTPCode(t, secret, time.Now())); err != nil {
		t.Fatalf("re-confirm authenticator: %v", err)
	}

	codes, err := service.GenerateRecoveryCodes(ctx, owner.ID)
	if err != nil {
		t.Fatalf("generate recovery codes: %v", err)
	}
	if len(codes) != 10 {
		t.Fatalf("expected ten recovery codes, got %d", len(codes))
	}
	result, err = service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyNone)
	if err != nil || result.Challenge == nil {
		t.Fatalf("expected a challenge: %#v err=%v", result, err)
	}
	recovered, err := service.CompleteChallenge(ctx, result.Challenge.Token, codes[0], auth.MFAPolicyNone)
	if err != nil {
		t.Fatalf("complete challenge with a recovery code: %v", err)
	}
	if recovered.AuthMethod != "recovery_code" {
		t.Fatalf("expected the recovery method to be recorded, got %q", recovered.AuthMethod)
	}
	result, err = service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyNone)
	if err != nil || result.Challenge == nil {
		t.Fatalf("expected a challenge: %#v err=%v", result, err)
	}
	if _, err := service.CompleteChallenge(ctx, result.Challenge.Token, codes[0], auth.MFAPolicyNone); !errors.Is(err, auth.ErrInvalidCode) {
		t.Fatalf("expected a used recovery code to be refused, got %v", err)
	}

	factors, err = service.Factors(ctx, owner.ID)
	if err != nil {
		t.Fatalf("read factors: %v", err)
	}
	if !factors.TOTPEnrolled || factors.RecoveryCodesRemaining != 9 {
		t.Fatalf("unexpected factor summary: %#v", factors)
	}

	// Policy protects the last factor of a covered role.
	if err := service.DisableTOTP(ctx, owner.ID, auth.MFAPolicyAdministrators, owner.Role); !errors.Is(err, auth.ErrLastFactor) {
		t.Fatalf("expected the last factor to be protected, got %v", err)
	}
	if err := service.DisableTOTP(ctx, owner.ID, auth.MFAPolicyNone, owner.Role); err != nil {
		t.Fatalf("remove the authenticator: %v", err)
	}

	// A policy change must not lock an unenrolled account out; it admits the
	// session with the enrollment gate set instead.
	gated, err := service.Login(ctx, auth.LoginInput{Username: owner.Username, Password: password}, auth.MFAPolicyAll)
	if err != nil || gated.Session == nil {
		t.Fatalf("expected an enrollment-gated session: %#v err=%v", gated, err)
	}
	if !gated.Session.EnrollmentPending {
		t.Fatal("expected the enrollment gate to be set")
	}
	authenticated, err := service.Authenticate(ctx, gated.Session.Token)
	if err != nil || !authenticated.EnrollmentPending {
		t.Fatalf("expected the gate to survive a round trip: %#v err=%v", authenticated, err)
	}
	if err := service.MarkEnrollmentSatisfied(ctx, owner.ID); err != nil {
		t.Fatalf("clear the gate: %v", err)
	}
	authenticated, err = service.Authenticate(ctx, gated.Session.Token)
	if err != nil || authenticated.EnrollmentPending {
		t.Fatalf("expected the gate to clear in place: %#v err=%v", authenticated, err)
	}

	// Administrative reset clears everything and revokes existing sessions.
	if _, _, err := service.BeginTOTPEnrollment(ctx, owner.ID, "Integration Library", owner.Username); err != nil {
		t.Fatalf("re-enroll: %v", err)
	}
	if err := service.ResetFactors(ctx, owner.ID, &owner.ID); err != nil {
		t.Fatalf("reset factors: %v", err)
	}
	if _, err := service.Authenticate(ctx, gated.Session.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("expected reset to revoke sessions, got %v", err)
	}
	factors, err = service.Factors(ctx, owner.ID)
	if err != nil || factors.Enrolled || factors.RecoveryCodesRemaining != 0 {
		t.Fatalf("expected reset to clear every factor: %#v err=%v", factors, err)
	}
}
