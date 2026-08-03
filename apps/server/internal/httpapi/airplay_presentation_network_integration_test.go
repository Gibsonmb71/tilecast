package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/presentnet"
)

func TestAirplayPresentationNetworkUsesOneGatewayAndWiredFanout(t *testing.T) {
	withPresentationNetworkDatabase(t, func(env activityTestEnvironment) {
		ctx := context.Background()
		groupID, followerID := airplayGroupFixture(t, env)
		secret := "test-only-airplay-psk"
		network, err := env.server.presentationNetworks.Create(ctx, env.owner.User.ID, presentnet.Input{
			Name:     "District Staff Wi-Fi",
			SSID:     "District-Staff",
			Security: presentnet.SecurityPSK,
			Secret:   &secret,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := env.server.presentationNetworks.Assign(ctx, env.owner.User.ID, env.screenID, network.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := env.pool.Exec(ctx, `UPDATE screen_player_status SET
			presentation_network_supported=true,
			presentation_network_helper_state='ok',
			presentation_network_manager_available=true,
			presentation_network_wifi_adapter=true,
			presentation_network_state='provisioned',
			presentation_network_installed_id=$2,
			presentation_network_installed_revision=$3,
			wired_interface_available=true,
			wired_ipv4='192.0.2.10'::inet
			WHERE screen_id=$1`, env.screenID, network.ID, network.ConfigRevision); err != nil {
			t.Fatal(err)
		}
		if _, err := env.pool.Exec(ctx, `UPDATE screen_player_status SET
			wired_interface_available=true,wired_ipv4='192.0.2.11'::inet WHERE screen_id=$1`, followerID); err != nil {
			t.Fatal(err)
		}

		group := airplayCreateGroupSession(t, env, groupID, followerID, "unicast")
		if group.gatewayID != env.screenID || group.followerID != followerID {
			t.Fatalf("gateway=%s follower=%s, want gateway=%s follower=%s", group.gatewayID, group.followerID, env.screenID, followerID)
		}
		var persistedNetwork *uuid.UUID
		if err := env.pool.QueryRow(ctx, `SELECT presentation_network_id FROM external_presentation_sessions WHERE id=$1`, group.sessionID).Scan(&persistedNetwork); err != nil {
			t.Fatal(err)
		}
		if persistedNetwork == nil || *persistedNetwork != network.ID {
			t.Fatalf("persisted Presentation Network=%v, want %s", persistedNetwork, network.ID)
		}

		rows, err := env.pool.Query(ctx, `SELECT screen_id,payload::text FROM player_commands
			WHERE type='prepare_airplay_session' AND payload->>'sessionId'=$1 ORDER BY screen_id`, group.sessionID.String())
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		payloads := map[uuid.UUID]map[string]any{}
		for rows.Next() {
			var screenID uuid.UUID
			var raw string
			if err := rows.Scan(&screenID, &raw); err != nil {
				t.Fatal(err)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(raw), &payload); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(raw, secret) || strings.Contains(raw, "TCPN") {
				t.Fatalf("AirPlay command leaked the Presentation Network credential: %s", raw)
			}
			payloads[screenID] = payload
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		gatewayPayload, ok := payloads[env.screenID]
		if !ok {
			t.Fatal("gateway prepare command missing")
		}
		followerPayload, ok := payloads[followerID]
		if !ok {
			t.Fatal("follower prepare command missing")
		}
		if got := gatewayPayload["presentationNetworkId"]; got != network.ID.String() {
			t.Fatalf("gateway Presentation Network=%v, want %s", got, network.ID)
		}
		if _, present := followerPayload["presentationNetworkId"]; present {
			t.Fatal("follower prepare command carries a Presentation Network identifier")
		}
		destinations, ok := gatewayPayload["destinations"].([]any)
		if !ok || len(destinations) != 2 {
			t.Fatalf("gateway destinations=%v, want two explicit wired destinations", gatewayPayload["destinations"])
		}
		hosts := map[string]bool{}
		for _, item := range destinations {
			entry, ok := item.(map[string]any)
			if !ok {
				t.Fatalf("invalid destination=%v", item)
			}
			host, _ := entry["host"].(string)
			hosts[host] = true
		}
		if !hosts["127.0.0.1"] || !hosts["192.0.2.11"] || hosts["192.0.2.10"] {
			t.Fatalf("gateway destination hosts=%v, want loopback plus follower wired IPv4 only", hosts)
		}

		// Both receivers can prepare over Ethernet; only the gateway is released
		// to start the sender-facing AirPlay path after durable reconciliation.
		airplayMarkParticipants(t, env, group.sessionID, "waiting")
		env.server.ReconcileAirplaySessions(ctx)
		if status := airplaySessionStatus(t, env, group.sessionID); status != "waiting" {
			t.Fatalf("session status=%q after participant readiness, want waiting", status)
		}
		var startPayload string
		if err := env.pool.QueryRow(ctx, `SELECT payload::text FROM player_commands
			WHERE screen_id=$1 AND type='prepare_airplay_session' AND payload->>'sessionId'=$2 AND payload->>'phase'='start'`, env.screenID, group.sessionID.String()).Scan(&startPayload); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(startPayload, network.ID.String()) || strings.Contains(startPayload, secret) {
			t.Fatalf("gateway start payload=%s", startPayload)
		}

		stopped := httptest.NewRecorder()
		env.server.stopAirplaySession(stopped, airplayDashboardRequest(http.MethodPost,
			"/api/v1/airplay/sessions/"+group.sessionID.String()+"/stop", []byte(`{"reason":"test_cleanup"}`), env.owner))
		if stopped.Code != http.StatusOK {
			t.Fatalf("stop status=%d body=%s", stopped.Code, stopped.Body.String())
		}
		if status := airplaySessionStatus(t, env, group.sessionID); status != "ended" {
			t.Fatalf("session status=%q after stop, want ended", status)
		}
		var activeAssignments int
		if err := env.pool.QueryRow(ctx, `SELECT count(*) FROM screen_player_status WHERE external_presentation_session_id=$1`, group.sessionID).Scan(&activeAssignments); err != nil {
			t.Fatal(err)
		}
		if activeAssignments != 0 {
			t.Fatalf("%d screens retained the ended AirPlay session", activeAssignments)
		}
	})
}
