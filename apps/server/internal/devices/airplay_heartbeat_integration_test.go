package devices

import (
	"context"
	"os"
	"testing"
	"time"

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

func TestStaleActiveHeartbeatCannotRebindAnotherSession(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	assigned, stale := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state='waiting',external_presentation_session_id=$2,external_presentation_role='single',airplay_receiver_state='waiting',airplay_transport='unicast',airplay_connected=false WHERE screen_id=$1`, principal.ScreenID, assigned); err != nil {
		t.Fatal(err)
	}

	connected := true
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState:     "connected",
		ExternalPresentationSessionID: &stale,
		ExternalPresentationRole:      "single",
		AirplayReceiverState:          "connected",
		AirplayTransport:              "unicast",
		AirplayConnected:              &connected,
	})

	var storedState, storedRole, storedReceiver, storedTransport *string
	var storedSession *uuid.UUID
	var storedConnected *bool
	if err := pool.QueryRow(ctx, `SELECT external_presentation_state,external_presentation_session_id,external_presentation_role,airplay_receiver_state,airplay_transport,airplay_connected FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).
		Scan(&storedState, &storedSession, &storedRole, &storedReceiver, &storedTransport, &storedConnected); err != nil {
		t.Fatal(err)
	}
	if storedState == nil || *storedState != "waiting" || storedSession == nil || *storedSession != assigned || storedRole == nil || *storedRole != "single" || storedReceiver == nil || *storedReceiver != "waiting" || storedTransport == nil || *storedTransport != "unicast" || storedConnected == nil || *storedConnected {
		t.Fatalf("stale heartbeat changed the assigned presentation: state=%v session=%v role=%v receiver=%v transport=%v connected=%v", storedState, storedSession, storedRole, storedReceiver, storedTransport, storedConnected)
	}

	// A non-none heartbeat without a session ID is just as stale/ambiguous and
	// must not be allowed to advance the server-owned snapshot.
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState: "connected",
		AirplayConnected:          &connected,
	})
	if err := pool.QueryRow(ctx, `SELECT external_presentation_state,external_presentation_session_id FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).
		Scan(&storedState, &storedSession); err != nil {
		t.Fatal(err)
	}
	if storedState == nil || *storedState != "waiting" || storedSession == nil || *storedSession != assigned {
		t.Fatalf("ambiguous heartbeat changed the assigned presentation: state=%v session=%v", storedState, storedSession)
	}
}

func TestHeartbeatCannotPromoteAReceiverIntoTheGateway(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	var organizationID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM screens WHERE id=$1`, principal.ScreenID).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_sessions(id,organization_id,provider,status,target_type,target_id,gateway_screen_id,receiver_name,pin,device_id,expires_at,transport,video_port,audio_port,video_profile,audio_mode)
		VALUES($1,$2,'airplay','preparing','group',$3,$4,'Library Room','4821','02:11:22:33:44:55',$5,'unicast',42000,42002,'720p30','none')`, sessionID, organizationID, uuid.New(), principal.ScreenID, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_screen_states(session_id,screen_id,role,state) VALUES($1,$2,'receiver','preparing')`, sessionID, principal.ScreenID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state='preparing',external_presentation_session_id=$2,external_presentation_role='receiver' WHERE screen_id=$1`, principal.ScreenID, sessionID); err != nil {
		t.Fatal(err)
	}

	connected := true
	claimedRole := "gateway"
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState:     "connected",
		ExternalPresentationSessionID: &sessionID,
		ExternalPresentationRole:      claimedRole,
		AirplayReceiverState:          "connected",
		AirplayTransport:              "unicast",
		AirplayConnected:              &connected,
	})

	var status, storedRole string
	if err := pool.QueryRow(ctx, `SELECT status FROM external_presentation_sessions WHERE id=$1`, sessionID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "preparing" {
		t.Fatalf("session status = %q, want preparing for a server-assigned receiver", status)
	}
	if err := pool.QueryRow(ctx, `SELECT external_presentation_role FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&storedRole); err != nil {
		t.Fatal(err)
	}
	if storedRole != "receiver" {
		t.Fatalf("external_presentation_role = %q, want server-assigned receiver", storedRole)
	}
}

func TestHeartbeatCannotResurrectStoppingOrTerminalSession(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	var organizationID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM screens WHERE id=$1`, principal.ScreenID).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_sessions(id,organization_id,provider,status,target_type,target_id,gateway_screen_id,receiver_name,pin,device_id,expires_at,transport,video_port,audio_port,video_profile,audio_mode)
		VALUES($1,$2,'airplay','stopping','screen',$3,$3,'Library Room','4821','02:11:22:33:44:55',$4,'unicast',42000,42002,'720p30','none')`, sessionID, organizationID, principal.ScreenID, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_screen_states(session_id,screen_id,role,state) VALUES($1,$2,'single','waiting')`, sessionID, principal.ScreenID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state='waiting',external_presentation_session_id=$2,external_presentation_role='single',airplay_receiver_state='waiting' WHERE screen_id=$1`, principal.ScreenID, sessionID); err != nil {
		t.Fatal(err)
	}

	connected := true
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState:     "connected",
		ExternalPresentationSessionID: &sessionID,
		AirplayConnected:              &connected,
	})
	var status, observedState string
	if err := pool.QueryRow(ctx, `SELECT ep.status,ps.external_presentation_state FROM external_presentation_sessions ep JOIN screen_player_status ps ON ps.external_presentation_session_id=ep.id WHERE ep.id=$1`, sessionID).Scan(&status, &observedState); err != nil {
		t.Fatal(err)
	}
	if status != "stopping" || observedState != "waiting" {
		t.Fatalf("stopping heartbeat resurrected session: status=%q observedState=%q", status, observedState)
	}

	if _, err := pool.Exec(ctx, `UPDATE external_presentation_sessions SET status='ended',pin=NULL,device_id=NULL WHERE id=$1`, sessionID); err != nil {
		t.Fatal(err)
	}
	service.updateAirplayHeartbeat(ctx, principal.ScreenID, Heartbeat{
		ExternalPresentationState:     "connected",
		ExternalPresentationSessionID: &sessionID,
		AirplayConnected:              &connected,
	})
	var clearedSession *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT external_presentation_session_id FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&clearedSession); err != nil {
		t.Fatal(err)
	}
	if clearedSession != nil {
		t.Fatalf("terminal heartbeat retained session %v", *clearedSession)
	}
}

func TestStoppingAirplaySessionIsReconciledAfterRestart(t *testing.T) {
	service, pool, principal := airplayHeartbeatTestService(t)
	ctx := context.Background()
	var organizationID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT organization_id FROM screens WHERE id=$1`, principal.ScreenID).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_sessions(id,organization_id,provider,status,target_type,target_id,gateway_screen_id,receiver_name,pin,device_id,expires_at,transport,video_port,audio_port,video_profile,audio_mode,end_reason)
		VALUES($1,$2,'airplay','stopping','screen',$3,$3,'Library Room','4821','02:11:22:33:44:55',$4,'unicast',42000,42002,'720p30','none','manual_stop')`, sessionID, organizationID, principal.ScreenID, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO external_presentation_screen_states(session_id,screen_id,role,state) VALUES($1,$2,'single','waiting')`, sessionID, principal.ScreenID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE screen_player_status SET external_presentation_state='waiting',external_presentation_session_id=$2,external_presentation_role='single' WHERE screen_id=$1`, principal.ScreenID, sessionID); err != nil {
		t.Fatal(err)
	}
	prepareID := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,expires_at)
		VALUES($1,$2,$3,'prepare_airplay_session',jsonb_build_object('sessionId',$4::text),$5,now()+interval '5 minutes')`, prepareID, organizationID, principal.ScreenID, sessionID, uuid.New()); err != nil {
		t.Fatal(err)
	}

	// The process may have stopped after the session row was marked stopping.
	// The startup/periodic expiry worker must finish the transition and queue a
	// server-owned cleanup command even though the original expiry is in the
	// future.
	service.ExpireAirplaySessions(ctx)

	var status string
	var pin, deviceID *string
	if err := pool.QueryRow(ctx, `SELECT status,pin,device_id FROM external_presentation_sessions WHERE id=$1`, sessionID).Scan(&status, &pin, &deviceID); err != nil {
		t.Fatal(err)
	}
	if status != "ended" || pin != nil || deviceID != nil {
		t.Fatalf("session cleanup = status %q pin %v device %v", status, pin, deviceID)
	}
	var screenState string
	if err := pool.QueryRow(ctx, `SELECT state FROM external_presentation_screen_states WHERE session_id=$1 AND screen_id=$2`, sessionID, principal.ScreenID).Scan(&screenState); err != nil {
		t.Fatal(err)
	}
	if screenState != "stopped" {
		t.Fatalf("screen state = %q, want stopped", screenState)
	}
	var statusRow *string
	if err := pool.QueryRow(ctx, `SELECT external_presentation_session_id::text FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&statusRow); err != nil {
		t.Fatal(err)
	}
	if statusRow != nil {
		t.Fatalf("screen status retained session %v", *statusRow)
	}
	var prepareState, prepareCode string
	if err := pool.QueryRow(ctx, `SELECT state,COALESCE(safe_result_code,'') FROM player_commands WHERE id=$1`, prepareID).Scan(&prepareState, &prepareCode); err != nil {
		t.Fatal(err)
	}
	if prepareState != "cancelled" {
		t.Fatalf("prepare command state = %q, want cancelled", prepareState)
	}
	if prepareCode != "airplay_session_stopped" {
		t.Fatalf("prepare command result code = %q, want airplay_session_stopped", prepareCode)
	}
	var stopCount int
	var stopReason string
	if err := pool.QueryRow(ctx, `SELECT count(*),COALESCE(max(payload->>'reason'),'') FROM player_commands WHERE screen_id=$1 AND type='stop_airplay_session' AND payload->>'sessionId'=$2`, principal.ScreenID, sessionID.String()).Scan(&stopCount, &stopReason); err != nil {
		t.Fatal(err)
	}
	if stopCount != 1 || stopReason != "manual_stop" {
		t.Fatalf("cleanup commands = %d reason %q, want one manual_stop command", stopCount, stopReason)
	}
}
