package devices

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/database"
)

func airplayHeartbeatTestService(t *testing.T) (*Service, *pgxpool.Pool, DevicePrincipal) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(lockPool.Close)
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(lock.Release)
	if _, err = lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) }) //nolint:errcheck
	if err = database.Migrate(ctx, databaseURL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings, users CASCADE`); err != nil {
		t.Fatal(err)
	}
	organizationID, screenID := uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(true,'AirPlay Test',$1)`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone) VALUES($1,$2,$3,'Library TV','linux','Test','Linux x64','6','0.12.0',1920,1080,1,'en_US','America/New_York')`, screenID, organizationID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screen_player_status(screen_id) VALUES($1)`, screenID); err != nil {
		t.Fatal(err)
	}
	return NewService(pool, NewPresenceHub(), ""), pool, DevicePrincipal{ScreenID: screenID, ScreenName: "Library TV", Enabled: true}
}

// An idle Linux player reports externalPresentationState 'none' on every
// heartbeat. Capability reporting must not be conditioned on owning a live
// session: doing so deadlocks the feature, because Studio will not let an
// operator start a presentation until it has seen the capabilities.
func TestAirplayCapabilitiesPersistWhileIdle(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	supported, hardware, group := true, true, true

	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		AirplaySupported:          &supported,
		AirplayHardwareDecode:     &hardware,
		AirplayGroupSupported:     &group,
		AirplayMaxProfile:         "1080p30",
		AirplayUxPlayVersion:      "1.68",
		ExternalPresentationState: "none",
	})

	var storedSupported, storedGroup *bool
	var storedProfile, storedVersion *string
	var storedState *string
	if err := pool.QueryRow(ctx, `SELECT airplay_supported,airplay_group_supported,airplay_max_profile,airplay_uxplay_version,external_presentation_state FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).
		Scan(&storedSupported, &storedGroup, &storedProfile, &storedVersion, &storedState); err != nil {
		t.Fatal(err)
	}
	if storedSupported == nil || !*storedSupported {
		t.Fatalf("airplay_supported = %v, want true", storedSupported)
	}
	if storedGroup == nil || !*storedGroup {
		t.Fatalf("airplay_group_supported = %v, want true", storedGroup)
	}
	if storedProfile == nil || *storedProfile != "1080p30" {
		t.Fatalf("airplay_max_profile = %v, want 1080p30", storedProfile)
	}
	if storedVersion == nil || *storedVersion != "1.68" {
		t.Fatalf("airplay_uxplay_version = %v, want 1.68", storedVersion)
	}
	if storedState != nil {
		t.Fatalf("external_presentation_state = %v, want NULL for an idle player", *storedState)
	}
}

// The probe's own diagnosis is what makes a failed capability check
// actionable, and it has to clear once provisioning fixes the box.
func TestAirplayLimitationIsStoredAndCleared(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	unsupported, supported := false, true

	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		AirplaySupported:          &unsupported,
		AirplayLimitation:         "UxPlay is not installed; AirPlay needs UxPlay 1.73.6 or newer.",
		ExternalPresentationState: "none",
	})
	var stored *string
	if err := pool.QueryRow(ctx, `SELECT airplay_limitation FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == nil || *stored != "UxPlay is not installed; AirPlay needs UxPlay 1.73.6 or newer." {
		t.Fatalf("airplay_limitation = %v", stored)
	}

	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		AirplaySupported:          &supported,
		ExternalPresentationState: "none",
	})
	if err := pool.QueryRow(ctx, `SELECT airplay_limitation FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored != nil {
		t.Fatalf("airplay_limitation = %q, want NULL once the player reports no limitation", *stored)
	}

	// A heartbeat carrying no capability report at all must not wipe the last
	// known diagnosis: that is the pre-0.13 player case.
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		AirplaySupported:          &unsupported,
		AirplayLimitation:         "Avahi/Bonjour support is unavailable; AirPlay cannot be advertised.",
		ExternalPresentationState: "none",
	})
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{ExternalPresentationState: "none"})
	if err := pool.QueryRow(ctx, `SELECT airplay_limitation FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == nil {
		t.Fatal("airplay_limitation was cleared by a heartbeat with no capability report")
	}
}

// The guard that the capability write no longer shares still has to hold: a
// player reporting 'none' for a session it does not own must not clear the
// snapshot of the session the server has since assigned.
func TestIdleHeartbeatCannotClearAnotherSession(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	assigned, stale := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state='preparing',external_presentation_session_id=$2,external_presentation_role='single' WHERE screen_id=$1`, principal.ScreenID, assigned); err != nil {
		t.Fatal(err)
	}

	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState:     "none",
		ExternalPresentationSessionID: &stale,
	})

	var storedState *string
	var storedSession *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT external_presentation_state,external_presentation_session_id FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).
		Scan(&storedState, &storedSession); err != nil {
		t.Fatal(err)
	}
	if storedState == nil || *storedState != "preparing" {
		t.Fatalf("external_presentation_state = %v, want preparing", storedState)
	}
	if storedSession == nil || *storedSession != assigned {
		t.Fatalf("external_presentation_session_id = %v, want %v", storedSession, assigned)
	}
}
