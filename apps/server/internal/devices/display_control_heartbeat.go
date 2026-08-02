package devices

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/displaycontrol"
)

var displayControlPolicyStates = map[string]bool{
	"": true, "normal": true, "powered_off_by_policy": true, "unknown": true,
}

func (s *Service) updateDisplayControlHeartbeat(ctx context.Context, screenID uuid.UUID, heartbeat Heartbeat) {
	capabilities := heartbeat.DisplayControlCapabilities
	if capabilities != nil && displaycontrol.ValidateCapabilities(capabilities) != nil {
		capabilities = nil
	}
	providers := heartbeat.DisplayControlProviders
	validProviders := providers[:0]
	for _, provider := range providers {
		if displaycontrol.IsProvider(provider) && len(provider) <= 32 {
			validProviders = append(validProviders, provider)
		}
	}
	if len(validProviders) == 0 {
		validProviders = nil
	}
	provider := heartbeat.DisplayControlProvider
	if !displaycontrol.IsProvider(provider) {
		provider = ""
	}
	powerState := heartbeat.DisplayPowerState
	if powerState != "" && !displaycontrol.IsPowerState(powerState) {
		powerState = ""
	}
	policyState := heartbeat.DisplayControlPolicyState
	if !displayControlPolicyStates[policyState] {
		policyState = ""
	}
	errorText := strings.TrimSpace(heartbeat.DisplayControlError)
	if runes := []rune(errorText); len(runes) > 240 {
		errorText = string(runes[:240])
	}
	var capabilityJSON []byte
	if capabilities != nil {
		capabilityJSON, _ = json.Marshal(capabilities)
	}
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		display_control_provider=COALESCE(NULLIF($2,''),display_control_provider),
		display_control_providers=COALESCE($3::text[],display_control_providers),
		display_control_capabilities=COALESCE($4::jsonb,display_control_capabilities),
		display_power_state=COALESCE(NULLIF($5,''),display_power_state),
		display_power_state_confirmed=COALESCE($6,display_power_state_confirmed),
		display_power_state_observed_at=COALESCE($7,display_power_state_observed_at),
		display_control_policy_state=COALESCE(NULLIF($8,''),display_control_policy_state),
		display_control_error=COALESCE(NULLIF($9,''),display_control_error)
		WHERE screen_id=$1`, screenID, provider, validProviders, capabilityJSON, powerState,
		heartbeat.DisplayPowerStateConfirmed, heartbeat.DisplayPowerStateObservedAt, policyState, errorText)
}
