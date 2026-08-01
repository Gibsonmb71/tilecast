package httpapi

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

var displayControlCommandTypes = map[string]bool{
	"display_power_on": true, "display_power_off": true,
	"display_set_input": true, "display_set_volume": true,
	"display_mute": true, "display_unmute": true,
	"display_set_brightness": true, "display_probe": true,
}

// recordDisplayControlCommandResult keeps the protocol acknowledgement and the
// display-state observation separate. A successful command means the player
// accepted and attempted the bounded provider call; only a later heartbeat (or
// a provider's explicit confirmation) can claim that the panel changed state.
func (s *server) recordDisplayControlCommandResult(ctx context.Context, id uuid.UUID, state, code, message string) {
	var commandType string
	if err := s.db.QueryRow(ctx, `SELECT type FROM player_commands WHERE id=$1`, id).Scan(&commandType); err != nil || !displayControlCommandTypes[commandType] {
		return
	}
	if runes := []rune(message); len(runes) > 240 {
		message = string(runes[:240])
	}
	errorText := ""
	if state != "succeeded" {
		errorText = strings.TrimSpace(message)
	}
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		display_control_last_command_id=$2,
		display_control_last_command_state=$3,
		display_control_last_command_result=NULLIF($4,''),
		display_control_last_command_sent_at=now(),
		display_control_last_state_confirmed_at=CASE WHEN $4='display_state_confirmed' THEN now() ELSE display_control_last_state_confirmed_at END,
		display_control_error=CASE WHEN $3='succeeded' THEN NULL ELSE NULLIF($5,'') END
		WHERE screen_id=(SELECT screen_id FROM player_commands WHERE id=$2)`, id, id, state, code, errorText)
}
