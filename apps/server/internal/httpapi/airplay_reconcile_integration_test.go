package httpapi

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// airplayGroup is a two-display AirPlay group session created through the real
// activation handler, so every test below starts from the same durable state a
// production activation leaves behind.
type airplayGroup struct {
	groupID    uuid.UUID
	sessionID  uuid.UUID
	gatewayID  uuid.UUID
	followerID uuid.UUID
}

func airplayGroupSetup(t *testing.T, env activityTestEnvironment) airplayGroup {
	t.Helper()
	groupID, secondID := airplayGroupFixture(t, env)
	return airplayCreateGroupSession(t, env, groupID, secondID, "unicast")
}

// airplayGroupFixture builds the two AirPlay-capable Linux displays and the
// screen group they belong to, without starting a session.
func airplayGroupFixture(t *testing.T, env activityTestEnvironment) (groupID, secondID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	airplayCreateTestSetup(t, env)

	var organizationID uuid.UUID
	if err := env.pool.QueryRow(ctx, `SELECT organization_id FROM screens WHERE id=$1`, env.screenID).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	secondID = uuid.New()
	if _, err := env.pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone,enabled,last_heartbeat_at,last_known_ip)
		VALUES($1,$2,$3,'Gym TV','linux','Test','Linux x64','','0.13.1',1920,1080,1,'en-US','America/New_York',true,now(),'192.0.2.11'::inet)`, secondID, organizationID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if _, err := env.pool.Exec(ctx, `INSERT INTO screen_player_status(screen_id,airplay_supported,airplay_uxplay_installed,airplay_gstreamer_installed,airplay_h264_decoder_available,airplay_hardware_decode,airplay_decoder,airplay_max_profile,airplay_group_supported,airplay_audio_available,airplay_avahi_available,airplay_mdns_advertisement_available,airplay_multicast_supported)
		VALUES($1,true,true,true,true,true,'vah264dec','1080p30',true,true,true,true,true)`, secondID); err != nil {
		t.Fatal(err)
	}
	groupID = uuid.New()
	if _, err := env.pool.Exec(ctx, `INSERT INTO screen_groups(id,organization_id,name) VALUES($1,$2,'Cafeteria Room')`, groupID, organizationID); err != nil {
		t.Fatal(err)
	}
	for _, screen := range []uuid.UUID{env.screenID, secondID} {
		if _, err := env.pool.Exec(ctx, `INSERT INTO screen_group_memberships(screen_group_id,screen_id) VALUES($1,$2)`, groupID, screen); err != nil {
			t.Fatal(err)
		}
	}
	return groupID, secondID
}

func airplayCreateGroupSession(t *testing.T, env activityTestEnvironment, groupID, secondID uuid.UUID, transport string) airplayGroup {
	t.Helper()
	body, _ := json.Marshal(airplaySessionInput{TargetType: "group", TargetID: groupID, DurationMinutes: 60, Transport: transport, AudioMode: "none"})
	recorder := httptest.NewRecorder()
	env.server.createAirplaySession(recorder, airplayDashboardRequest(http.MethodPost, "/api/v1/airplay/sessions", body, env.owner))
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("group create status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var envelope struct {
		Data struct {
			ID              uuid.UUID `json:"id"`
			GatewayScreenID uuid.UUID `json:"gatewayScreenId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	follower := env.screenID
	if envelope.Data.GatewayScreenID == env.screenID {
		follower = secondID
	}
	return airplayGroup{groupID: groupID, sessionID: envelope.Data.ID, gatewayID: envelope.Data.GatewayScreenID, followerID: follower}
}

func airplayMarkParticipants(t *testing.T, env activityTestEnvironment, sessionID uuid.UUID, state string) {
	t.Helper()
	if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_screen_states SET state=$2,last_updated_at=now() WHERE session_id=$1`, sessionID, state); err != nil {
		t.Fatal(err)
	}
}

func airplayGatewayStartCount(t *testing.T, env activityTestEnvironment, group airplayGroup) int {
	t.Helper()
	var count int
	if err := env.pool.QueryRow(context.Background(), `SELECT count(*) FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'sessionId'=$2 AND payload->>'phase'='start'`, group.gatewayID, group.sessionID.String()).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func airplaySessionStatus(t *testing.T, env activityTestEnvironment, sessionID uuid.UUID) string {
	t.Helper()
	var status string
	if err := env.pool.QueryRow(context.Background(), `SELECT status FROM external_presentation_sessions WHERE id=$1`, sessionID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

// The restart hole this whole change exists to close: the group is durable and
// complete, but the process that would have released the gateway is gone. The
// startup sweep has to finish the job from the database alone.
func TestAirplayGroupPreparationResumesAfterServerRestart(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		// Every participant reported ready, and then the server process died
		// before it could queue the gateway start.
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		if status := airplaySessionStatus(t, env, group.sessionID); status != "preparing" {
			t.Fatalf("pre-restart status = %q, want preparing", status)
		}
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("gateway start commands before reconciliation = %d, want none", count)
		}

		env.server.ReconcileAirplaySessions(context.Background())

		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("gateway start commands = %d, want exactly one", count)
		}
		if status := airplaySessionStatus(t, env, group.sessionID); status != "waiting" {
			t.Fatalf("status after reconciliation = %q, want waiting", status)
		}
		var role, phase, pin string
		if err := env.pool.QueryRow(context.Background(), `SELECT payload->>'role',payload->>'phase',payload->>'pin' FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'phase'='start'`, group.gatewayID).Scan(&role, &phase, &pin); err != nil {
			t.Fatal(err)
		}
		if role != "gateway" || phase != "start" || pin == "" {
			t.Fatalf("gateway start payload role=%q phase=%q pin=%q", role, phase, pin)
		}

		// A second sweep — the periodic backstop — must not duplicate anything.
		env.server.ReconcileAirplaySessions(context.Background())
		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("gateway start commands after a repeat sweep = %d, want one", count)
		}
	})
}

// Reconciliation runs from request handlers, heartbeats, and a timer at once.
// Two of them observing a complete group must not both release the gateway.
func TestConcurrentAirplayReconciliationQueuesOneGatewayStart(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		airplayMarkParticipants(t, env, group.sessionID, "waiting")

		var wait sync.WaitGroup
		for i := 0; i < 8; i++ {
			wait.Add(1)
			go func() {
				defer wait.Done()
				env.server.reconcileAirplaySession(context.Background(), group.sessionID)
			}()
		}
		wait.Wait()

		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("concurrent reconciliation queued %d gateway starts, want one", count)
		}
		if status := airplaySessionStatus(t, env, group.sessionID); status != "waiting" {
			t.Fatalf("status = %q, want waiting", status)
		}
	})
}

func TestAirplayReconciliationFailsWhenAParticipantFails(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_screen_states SET state='failed' WHERE session_id=$1 AND screen_id=$2`, group.sessionID, group.followerID); err != nil {
			t.Fatal(err)
		}

		env.server.reconcileAirplaySession(context.Background(), group.sessionID)

		var status, reason string
		var pin, deviceID *string
		if err := env.pool.QueryRow(context.Background(), `SELECT status,COALESCE(end_reason,''),pin,device_id FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status, &reason, &pin, &deviceID); err != nil {
			t.Fatal(err)
		}
		if status != "failed" || reason != "group_preparation_failed" {
			t.Fatalf("session = %q/%q, want failed/group_preparation_failed", status, reason)
		}
		if pin != nil || deviceID != nil {
			t.Fatalf("failed session retained its temporary identity: pin=%v device=%v", pin, deviceID)
		}
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("a failed group queued %d gateway starts, want none", count)
		}
		var stopCommands int
		if err := env.pool.QueryRow(context.Background(), `SELECT count(*) FROM player_commands WHERE type='stop_airplay_session' AND payload->>'sessionId'=$1`, group.sessionID.String()).Scan(&stopCommands); err != nil {
			t.Fatal(err)
		}
		if stopCommands != 2 {
			t.Fatalf("cleanup commands = %d, want one per participant", stopCommands)
		}
	})
}

// The deadline is durable and absolute. A restart neither loses it nor grants
// the session a fresh 45 seconds.
func TestAirplayReconciliationFailsAfterThePreparationDeadline(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		var deadline, createdAt time.Time
		if err := env.pool.QueryRow(context.Background(), `SELECT prepare_deadline_at,created_at FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&deadline, &createdAt); err != nil {
			t.Fatal(err)
		}
		if gap := deadline.Sub(createdAt); gap < airplayPreparationWait-time.Second || gap > airplayPreparationWait+time.Second {
			t.Fatalf("stored preparation window = %s, want ~%s after creation", gap, airplayPreparationWait)
		}

		// Not yet due: an incomplete group is left alone rather than failed.
		env.server.ReconcileAirplaySessions(context.Background())
		if status := airplaySessionStatus(t, env, group.sessionID); status != "preparing" {
			t.Fatalf("status before the deadline = %q, want preparing", status)
		}

		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET prepare_deadline_at=now()-interval '1 second' WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}
		env.server.ReconcileAirplaySessions(context.Background())

		var status, reason string
		if err := env.pool.QueryRow(context.Background(), `SELECT status,COALESCE(end_reason,'') FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status, &reason); err != nil {
			t.Fatal(err)
		}
		if status != "failed" || reason != "group_preparation_timeout" {
			t.Fatalf("session = %q/%q, want failed/group_preparation_timeout", status, reason)
		}
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("a timed-out group queued %d gateway starts, want none", count)
		}
	})
}

// A session created before the deadline column existed still has to resolve;
// reconciliation derives the same window from created_at.
func TestAirplayReconciliationDerivesADeadlineForPreMigrationSessions(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET prepare_deadline_at=NULL,created_at=now()-interval '10 minutes' WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}

		env.server.ReconcileAirplaySessions(context.Background())

		if status := airplaySessionStatus(t, env, group.sessionID); status != "failed" {
			t.Fatalf("status = %q, want failed for a stranded pre-migration group", status)
		}
	})
}

// waiting/active are past the gate, and stopping/terminal belong to the stop
// and expiry paths. None of them may be handed a gateway start.
func TestAirplayReconciliationLeavesSettledSessionsAlone(t *testing.T) {
	for _, status := range []string{"waiting", "active", "stopping", "ended", "failed", "expired"} {
		t.Run(status, func(t *testing.T) {
			withActivityDatabase(t, func(env activityTestEnvironment) {
				group := airplayGroupSetup(t, env)
				airplayMarkParticipants(t, env, group.sessionID, "waiting")
				if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET status=$2 WHERE id=$1`, group.sessionID, status); err != nil {
					t.Fatal(err)
				}

				env.server.ReconcileAirplaySessions(context.Background())
				env.server.reconcileAirplaySession(context.Background(), group.sessionID)

				if count := airplayGatewayStartCount(t, env, group); count != 0 {
					t.Fatalf("a %s session queued %d gateway starts, want none", status, count)
				}
				if got := airplaySessionStatus(t, env, group.sessionID); got != status {
					t.Fatalf("status = %q, want it left at %q", got, status)
				}
			})
		})
	}
}

// Expiration outranks preparation. A group whose deadline passed during a
// restart must be expired, never resumed.
func TestAirplayReconciliationLetsExpirationWin(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 minute' WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}

		env.server.ReconcileAirplaySessions(context.Background())
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("an expired group queued %d gateway starts, want none", count)
		}

		env.server.devices.ExpireAirplaySessions(context.Background())
		var status string
		var pin *string
		if err := env.pool.QueryRow(context.Background(), `SELECT status,pin FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status, &pin); err != nil {
			t.Fatal(err)
		}
		if status != "expired" || pin != nil {
			t.Fatalf("expired session = %q pin=%v", status, pin)
		}
		// And the sweep must not resurrect it afterwards either.
		env.server.ReconcileAirplaySessions(context.Background())
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("reconciliation resurrected an expired session with %d gateway starts", count)
		}
	})
}

// A session outlives the Studio user who created it. Server-owned recovery
// must not need a user identity to release or to tear down a group.
func TestAirplayReconciliationWorksWithoutASessionCreator(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET created_by=NULL WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}

		env.server.ReconcileAirplaySessions(context.Background())

		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("gateway start commands = %d, want one", count)
		}
		var createdBy *uuid.UUID
		if err := env.pool.QueryRow(context.Background(), `SELECT created_by FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'phase'='start'`, group.gatewayID).Scan(&createdBy); err != nil {
			t.Fatal(err)
		}
		if createdBy != nil {
			t.Fatalf("server-owned gateway start recorded actor %v, want NULL", *createdBy)
		}
	})
}

func TestAirplayReconciliationFailsAGroupWithoutACreator(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		if _, err := env.pool.Exec(context.Background(), `UPDATE external_presentation_sessions SET created_by=NULL,prepare_deadline_at=now()-interval '1 second' WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}

		env.server.ReconcileAirplaySessions(context.Background())

		var status string
		var stopCommands int
		if err := env.pool.QueryRow(context.Background(), `SELECT status FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if err := env.pool.QueryRow(context.Background(), `SELECT count(*) FROM player_commands WHERE type='stop_airplay_session' AND payload->>'sessionId'=$1`, group.sessionID.String()).Scan(&stopCommands); err != nil {
			t.Fatal(err)
		}
		if status != "failed" || stopCommands != 2 {
			t.Fatalf("creatorless cleanup = status %q with %d stop commands", status, stopCommands)
		}
	})
}

// The command-result path is what normally releases a healthy group: the last
// prepare acknowledgement should advertise the gateway without waiting for a
// heartbeat or the periodic sweep.
func TestAirplayCommandResultReleasesTheGateway(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		ctx := context.Background()
		rows, err := env.pool.Query(ctx, `SELECT id FROM player_commands WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1 ORDER BY screen_id`, group.sessionID.String())
		if err != nil {
			t.Fatal(err)
		}
		commandIDs := []uuid.UUID{}
		for rows.Next() {
			var id uuid.UUID
			if rows.Scan(&id) == nil {
				commandIDs = append(commandIDs, id)
			}
		}
		rows.Close()
		if len(commandIDs) != 2 {
			t.Fatalf("prepare commands = %d, want one per participant", len(commandIDs))
		}

		env.server.recordAirplayCommandResult(ctx, commandIDs[0], "succeeded", "airplay_prepared", "")
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("a partially prepared group queued %d gateway starts, want none", count)
		}
		env.server.recordAirplayCommandResult(ctx, commandIDs[1], "succeeded", "airplay_prepared", "")
		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("gateway start commands = %d, want one once every participant is ready", count)
		}
		if status := airplaySessionStatus(t, env, group.sessionID); status != "waiting" {
			t.Fatalf("status = %q, want waiting", status)
		}
	})
}

// Multicast stays an optimization rather than a single point of failure: a
// degraded receiver restarts the same session over unicast, with a fresh
// preparation window, and reconciliation then releases it normally.
func TestAirplayMulticastFallbackRestartsPreparationOverUnicast(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		ctx := context.Background()
		groupID, secondID := airplayGroupFixture(t, env)
		group := airplayCreateGroupSession(t, env, groupID, secondID, "multicast")
		var originalDeadline time.Time
		if err := env.pool.QueryRow(ctx, `SELECT prepare_deadline_at FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&originalDeadline); err != nil {
			t.Fatal(err)
		}
		if _, err := env.pool.Exec(ctx, `UPDATE external_presentation_sessions SET prepare_deadline_at=now()-interval '1 second' WHERE id=$1`, group.sessionID); err != nil {
			t.Fatal(err)
		}
		if _, err := env.pool.Exec(ctx, `UPDATE external_presentation_screen_states SET state='degraded' WHERE session_id=$1 AND screen_id=$2`, group.sessionID, group.followerID); err != nil {
			t.Fatal(err)
		}

		env.server.fallbackAirplayForScreen(ctx, group.followerID)

		var status, transport string
		var multicast *string
		var deadline time.Time
		if err := env.pool.QueryRow(ctx, `SELECT status,transport,host(multicast_address),prepare_deadline_at FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status, &transport, &multicast, &deadline); err != nil {
			t.Fatal(err)
		}
		if status != "preparing" || transport != "unicast" || multicast != nil {
			t.Fatalf("fallback = %q/%q multicast=%v, want a preparing unicast session", status, transport, multicast)
		}
		// The retry needs a newly stamped window, not merely a future one:
		// reusing the exhausted deadline would fail the unicast attempt on the
		// very next reconciliation.
		if !deadline.After(originalDeadline) {
			t.Fatalf("preparation deadline = %s, want it re-stamped past the original %s", deadline, originalDeadline)
		}
		var preparingParticipants int
		if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM external_presentation_screen_states WHERE session_id=$1 AND state='preparing'`, group.sessionID).Scan(&preparingParticipants); err != nil {
			t.Fatal(err)
		}
		if preparingParticipants != 2 {
			t.Fatalf("participants reset to preparing = %d, want 2", preparingParticipants)
		}
		if count := airplayGatewayStartCount(t, env, group); count != 0 {
			t.Fatalf("fallback released the gateway early with %d start commands", count)
		}

		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		env.server.ReconcileAirplaySessions(ctx)
		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("gateway start commands after the unicast retry = %d, want one", count)
		}
	})
}

// A gateway that cannot start is a room failure, and the terminal transition
// has to take the temporary identity with it — including out of the persistent
// command history.
func TestAirplayGatewayStartFailureFailsTheSessionAndClearsSecrets(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		ctx := context.Background()
		group := airplayGroupSetup(t, env)
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		env.server.ReconcileAirplaySessions(ctx)

		var startCommandID uuid.UUID
		if err := env.pool.QueryRow(ctx, `SELECT id FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'phase'='start'`, group.gatewayID).Scan(&startCommandID); err != nil {
			t.Fatal(err)
		}

		env.server.recordAirplayCommandResult(ctx, startCommandID, "failed", "airplay_gateway_unsupported", "UxPlay could not bind 37000.")

		var status, reason string
		var pin, deviceID *string
		if err := env.pool.QueryRow(ctx, `SELECT status,COALESCE(end_reason,''),pin,device_id FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&status, &reason, &pin, &deviceID); err != nil {
			t.Fatal(err)
		}
		if status != "failed" || reason != "airplay_gateway_unsupported" || pin != nil || deviceID != nil {
			t.Fatalf("gateway start failure = %q/%q pin=%v device=%v", status, reason, pin, deviceID)
		}
		var retainedSecrets int
		if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM player_commands WHERE type='prepare_airplay_session' AND payload ? 'pin'`).Scan(&retainedSecrets); err != nil {
			t.Fatal(err)
		}
		if retainedSecrets != 0 {
			t.Fatalf("%d prepare commands still carry the session PIN", retainedSecrets)
		}
		var assignments int
		if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM screen_player_status WHERE external_presentation_session_id=$1`, group.sessionID).Scan(&assignments); err != nil {
			t.Fatal(err)
		}
		if assignments != 0 {
			t.Fatalf("%d screens still hold the failed session assignment", assignments)
		}
	})
}

func TestSafeAirplayMessageTruncatesWholeCharacters(t *testing.T) {
	// 240 multi-byte runes: a byte slice would cut the last one in half and
	// Postgres rejects the invalid UTF-8 that produces.
	long := ""
	for i := 0; i < 300; i++ {
		long += "é"
	}
	truncated := safeAirplayMessage(long)
	if runes := []rune(truncated); len(runes) != 240 {
		t.Fatalf("truncated length = %d runes, want 240", len(runes))
	}
	for _, r := range truncated {
		if r != 'é' {
			t.Fatalf("truncation produced %q, want only whole characters", r)
		}
	}
	if got := safeAirplayMessage("  "); got != "The Linux player could not start the AirPlay process." {
		t.Fatalf("empty message fallback = %q", got)
	}
	if got := safeAirplayMessage("uxplay exited"); got != "uxplay exited" {
		t.Fatalf("short message = %q, want it unchanged", got)
	}
}

// screens.last_known_ip is INET, and casting it with ::text renders the
// netmask: "192.0.2.10/32". That is not a parseable IP and not a legal RTP
// destination host, so every group activation was rejected with
// airplay_ip_invalid before it could reach a player. Assert the parsed address
// and the destination the gateway is actually given.
func TestAirplayGroupActivationUsesBareLanAddresses(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		group := airplayGroupSetup(t, env)
		screens, err := env.server.airplaySessionScreens(context.Background(), group.sessionID)
		if err != nil {
			t.Fatal(err)
		}
		if len(screens) != 2 {
			t.Fatalf("session screens = %d, want 2", len(screens))
		}
		for _, screen := range screens {
			if strings.Contains(screen.LastKnownIP, "/") {
				t.Fatalf("%s LAN address = %q, want a bare IPv4 address", screen.Name, screen.LastKnownIP)
			}
			if ip := net.ParseIP(screen.LastKnownIP); ip == nil || ip.To4() == nil {
				t.Fatalf("%s LAN address %q is not usable IPv4", screen.Name, screen.LastKnownIP)
			}
		}
		var destinations string
		if err := env.pool.QueryRow(context.Background(), `SELECT payload->>'destinations' FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'role'='gateway'`, group.gatewayID).Scan(&destinations); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(destinations, "/32") || !strings.Contains(destinations, "127.0.0.1") {
			t.Fatalf("gateway RTP destinations = %s", destinations)
		}
	})
}

// external_presentation_sessions.multicast_address is INET too. Reading it back
// with ::text produced "239.255.42.7/32", which the command validator rejects —
// so a multicast group failed the moment reconciliation built its gateway start
// payload from the stored session rather than from the in-memory record.
func TestAirplayMulticastGatewayStartCarriesABareGroupAddress(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		groupID, secondID := airplayGroupFixture(t, env)
		group := airplayCreateGroupSession(t, env, groupID, secondID, "multicast")

		var transport, stored string
		if err := env.pool.QueryRow(context.Background(), `SELECT transport,COALESCE(host(multicast_address),'') FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&transport, &stored); err != nil {
			t.Fatal(err)
		}
		if transport != "multicast" || stored == "" {
			t.Fatalf("session transport = %q address = %q, want a multicast session", transport, stored)
		}

		record, err := env.server.getAirplayRecord(context.Background(), group.sessionID)
		if err != nil {
			t.Fatal(err)
		}
		if !airplayMulticastPattern.MatchString(record.Multicast) {
			t.Fatalf("stored multicast address read back as %q, which the command validator rejects", record.Multicast)
		}

		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		env.server.ReconcileAirplaySessions(context.Background())

		if count := airplayGatewayStartCount(t, env, group); count != 1 {
			t.Fatalf("multicast gateway start commands = %d, want one", count)
		}
		var payloadAddress string
		if err := env.pool.QueryRow(context.Background(), `SELECT payload->>'multicastAddress' FROM player_commands WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'phase'='start'`, group.gatewayID).Scan(&payloadAddress); err != nil {
			t.Fatal(err)
		}
		if !airplayMulticastPattern.MatchString(payloadAddress) {
			t.Fatalf("gateway start multicastAddress = %q", payloadAddress)
		}
	})
}
