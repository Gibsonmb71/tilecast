package devices

import (
	"context"
	"net"
	"strings"

	"github.com/google/uuid"
)

var presentationNetworkStates = map[string]bool{
	"unsupported": true,
	"unassigned":  true,
	"pending":     true,
	"provisioned": true,
	"joining":     true,
	"connected":   true,
	"failed":      true,
}

var presentationNetworkHelperStates = map[string]bool{
	"ok": true, "missing": true, "unhealthy": true, "unsupported": true,
}

// updatePresentationNetworkHeartbeat stores what a Linux player reports about its
// Presentation Network capability and the wired address AirPlay group fan-out
// needs.
//
// Best effort, like the AirPlay capability write next to it: Presentation
// Networks are an optional capability, and an unrecognized state or a malformed
// identifier must never make a healthy player's heartbeat fail liveness. Values
// that do not pass validation are dropped rather than coerced, because a
// substituted value here is indistinguishable from a real reading — and a
// fabricated "wired address available" would send a room's video to nowhere.
func (s *Service) updatePresentationNetworkHeartbeat(ctx context.Context, screenID uuid.UUID, heartbeat Heartbeat) {
	state := strings.TrimSpace(heartbeat.PresentationNetworkState)
	if state != "" && !presentationNetworkStates[state] {
		state = ""
	}
	helperState := strings.TrimSpace(heartbeat.PresentationNetworkHelperState)
	if helperState != "" && !presentationNetworkHelperStates[helperState] {
		helperState = ""
	}
	limitation := truncateRunes(heartbeat.PresentationNetworkLimitation, 240)
	failureCode := truncateRunes(heartbeat.PresentationNetworkLastFailureCode, 80)

	// Only a real, unicast IPv4 address is stored. A player that reports
	// something else has its report dropped, and the AirPlay readiness check then
	// says precisely that no wired address is available instead of handing
	// GStreamer a destination that cannot work.
	wired := ""
	if candidate := strings.TrimSpace(heartbeat.WiredIPv4); candidate != "" {
		if address := net.ParseIP(candidate); address != nil {
			if v4 := address.To4(); v4 != nil && !v4.IsUnspecified() && !v4.IsLoopback() &&
				!v4.IsMulticast() && !v4.IsLinkLocalUnicast() {
				wired = v4.String()
			}
		}
	}

	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		presentation_network_supported=COALESCE($2,presentation_network_supported),
		presentation_network_helper_state=COALESCE(NULLIF($3,''),presentation_network_helper_state),
		presentation_network_manager_available=COALESCE($4,presentation_network_manager_available),
		presentation_network_wifi_adapter=COALESCE($5,presentation_network_wifi_adapter),
		presentation_network_radio_enabled=COALESCE($6,presentation_network_radio_enabled),
		presentation_network_state=COALESCE(NULLIF($7,''),presentation_network_state),
		-- Installed/active identifiers are cleared, not coalesced, whenever the
		-- player reports a state at all. A player that has just deleted an
		-- obsolete profile reports no installed network, and keeping the old value
		-- would show Studio a provisioned profile that is gone.
		presentation_network_installed_id=CASE WHEN $7<>'' THEN $8 ELSE presentation_network_installed_id END,
		presentation_network_installed_revision=CASE WHEN $7<>'' THEN $9 ELSE presentation_network_installed_revision END,
		presentation_network_active_id=CASE WHEN $7<>'' THEN $10 ELSE presentation_network_active_id END,
		presentation_network_last_connected_at=COALESCE($11,presentation_network_last_connected_at),
		presentation_network_last_failure_at=COALESCE($12,presentation_network_last_failure_at),
		presentation_network_last_failure_code=CASE WHEN $7='failed' THEN NULLIF($13,'') ELSE NULL END,
		-- Cleared, not coalesced: once provisioning fixes the box the operator
		-- must stop seeing the sentence describing what used to be missing.
		presentation_network_limitation=CASE WHEN $2 IS NOT NULL THEN NULLIF($14,'') ELSE presentation_network_limitation END,
		wired_interface_available=COALESCE($15,wired_interface_available),
		wired_ipv4=CASE WHEN $16<>'' THEN $16::inet
		                WHEN $15 IS NOT NULL AND NOT $15 THEN NULL
		                ELSE wired_ipv4 END
		WHERE screen_id=$1`,
		screenID,
		heartbeat.PresentationNetworkSupported,
		helperState,
		heartbeat.PresentationNetworkManagerAvailable,
		heartbeat.PresentationNetworkWifiAdapter,
		heartbeat.PresentationNetworkRadioEnabled,
		state,
		heartbeat.PresentationNetworkInstalledID,
		heartbeat.PresentationNetworkInstalledRev,
		heartbeat.PresentationNetworkActiveID,
		heartbeat.PresentationNetworkLastConnectedAt,
		heartbeat.PresentationNetworkLastFailureAt,
		failureCode,
		limitation,
		heartbeat.WiredInterfaceAvailable,
		wired,
	)
}

// truncateRunes bounds a reported string by rune. Slicing bytes can cut a
// multi-byte character in half, and Postgres rejects the invalid UTF-8 that
// produces — which would turn a cosmetic overlong message into a rejected
// heartbeat.
func truncateRunes(value string, limit int) string {
	value = strings.TrimSpace(value)
	if runes := []rune(value); len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}
