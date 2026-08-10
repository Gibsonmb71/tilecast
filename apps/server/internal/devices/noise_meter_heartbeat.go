package devices

import (
	"context"
	"math"

	"github.com/google/uuid"
)

var noiseMeterStatuses = map[string]bool{
	"active":      true,
	"normal":      true,
	"loud":        true,
	"unavailable": true,
	"inactive":    true,
}

// updateNoiseMeterHeartbeat records only what the live meter is doing right
// now, for player health and debugging. The historical buckets in the same
// heartbeat belong to the plugins package, which owns their storage and their
// idempotency.
//
// Best effort, like every other optional heartbeat section: a Player that
// reports an unrecognised status keeps its liveness and its playback status
// rather than failing the whole heartbeat over a field nothing depends on.
func (s *Service) updateNoiseMeterHeartbeat(ctx context.Context, screenID uuid.UUID, heartbeat Heartbeat) {
	report := heartbeat.NoiseMeter
	if report == nil {
		return
	}
	status := report.Status
	if !noiseMeterStatuses[status] {
		status = ""
	}
	var level *float64
	if report.CurrentLevel != nil {
		value := *report.CurrentLevel
		if !math.IsNaN(value) && !math.IsInf(value, 0) {
			clamped := math.Min(100, math.Max(0, value))
			level = &clamped
		}
	}
	if status == "" && level == nil {
		return
	}
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET
		noise_meter_status=COALESCE(NULLIF($2,''),noise_meter_status),
		noise_meter_level=COALESCE($3,noise_meter_level),
		noise_meter_reported_at=now()
		WHERE screen_id=$1`, screenID, status, level)
}
