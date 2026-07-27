package httpapi

import "time"

// Threshold policy for player telemetry.
//
// Every one of these measurements fluctuates. Emitting an event whenever a
// value crosses a single line would produce a stream of "latency excessive" /
// "latency recovered" pairs from one flapping network, which is noise that
// buries the real problems. Two mechanisms prevent that:
//
//   - hysteresis: the level that enters a condition is worse than the level
//     that leaves it, so a value sitting on the boundary cannot oscillate;
//   - a cooldown: a condition that has just changed cannot change again for a
//     minimum period, so even a wildly swinging measurement is rate-limited.

type telemetryThreshold struct {
	Condition string
	// Entering requires crossing this; leaving requires coming back past
	// Exit, which is deliberately the more forgiving of the two.
	Enter float64
	Exit  float64
	// True when a higher value is the bad direction.
	HigherIsWorse bool
	// The events emitted on each transition.
	EnterEvent string
	ExitEvent  string
	Severity   string
	Cooldown   time.Duration
}

// Cooldowns are longer for conditions whose underlying measurement is noisier.
// Latency in particular swings constantly on a congested network.
var telemetryThresholds = []telemetryThreshold{
	{
		Condition: "playback_stalled",
		// Seconds of stall, from the render-progress detector rather than from
		// renderer liveness.
		Enter: 60, Exit: 10, HigherIsWorse: true,
		EnterEvent: "playback.stalled", ExitEvent: "playback.resumed",
		Severity: "error", Cooldown: 2 * time.Minute,
	},
	{
		Condition: "visual_output_frozen",
		// Seconds since the frame last changed while motion was expected.
		Enter: 120, Exit: 15, HigherIsWorse: true,
		EnterEvent: "visual_output.frozen", ExitEvent: "visual_output.recovered",
		Severity: "error", Cooldown: 5 * time.Minute,
	},
	{
		Condition: "black_output",
		// Average luminance. Lower is worse here, and the exit level is well
		// above the entry so genuinely dark content does not flap.
		Enter: 0.02, Exit: 0.08, HigherIsWorse: false,
		EnterEvent: "visual_output.black", ExitEvent: "visual_output.recovered",
		Severity: "error", Cooldown: 5 * time.Minute,
	},
	{
		Condition: "network_latency_excessive",
		Enter:     2000, Exit: 800, HigherIsWorse: true,
		EnterEvent: "network.latency_excessive", ExitEvent: "network.latency_recovered",
		Severity: "warning", Cooldown: 10 * time.Minute,
	},
	{
		Condition: "download_failing",
		// Consecutive failures for one asset.
		Enter: 3, Exit: 0, HigherIsWorse: true,
		EnterEvent: "download.repeatedly_failed", ExitEvent: "download.recovered",
		Severity: "error", Cooldown: 5 * time.Minute,
	},
	{
		Condition: "sync_drift",
		// Absolute drift in milliseconds against the sync group.
		Enter: 500, Exit: 150, HigherIsWorse: true,
		EnterEvent: "sync.drift_exceeded", ExitEvent: "sync.drift_recovered",
		Severity: "warning", Cooldown: 5 * time.Minute,
	},
	{
		Condition: "storage_pressure",
		// Percent of the cache limit used. The ten-point gap is the hysteresis
		// that stops a cache hovering at the limit from flapping.
		Enter: 90, Exit: 80, HigherIsWorse: true,
		EnterEvent: "storage.pressure", ExitEvent: "storage.recovered",
		Severity: "warning", Cooldown: 15 * time.Minute,
	},
}

var telemetryThresholdsByCondition = func() map[string]telemetryThreshold {
	index := map[string]telemetryThreshold{}
	for _, threshold := range telemetryThresholds {
		index[threshold.Condition] = threshold
	}
	return index
}()

// crossed reports what a measurement means for a condition that is currently
// `active`. The two-level test is the hysteresis: between Exit and Enter the
// answer is "no change", which is what keeps a boundary-hugging value quiet.
func (t telemetryThreshold) crossed(value float64, active bool) (enter bool, exit bool) {
	if t.HigherIsWorse {
		if !active && value >= t.Enter {
			return true, false
		}
		if active && value <= t.Exit {
			return false, true
		}
		return false, false
	}
	if !active && value <= t.Enter {
		return true, false
	}
	if active && value >= t.Exit {
		return false, true
	}
	return false, false
}

// Discrete states have no numeric threshold, so hysteresis does not apply.
// They still get a cooldown, because a device oscillating between thermal
// states would otherwise emit an event per reading.
type telemetryStateCondition struct {
	Condition string
	// The states that count as the condition being held.
	CriticalStates []string
	EnterEvent     string
	ExitEvent      string
	Severity       string
	Cooldown       time.Duration
}

var telemetryStateConditions = []telemetryStateCondition{
	{
		Condition:      "memory_pressure_critical",
		CriticalStates: []string{"critical"},
		EnterEvent:     "memory.pressure_critical", ExitEvent: "memory.pressure_recovered",
		Severity: "error", Cooldown: 5 * time.Minute,
	},
	{
		Condition:      "thermal_unsafe",
		CriticalStates: []string{"severe", "critical", "emergency", "shutdown"},
		EnterEvent:     "thermal.unsafe", ExitEvent: "thermal.recovered",
		Severity: "error", Cooldown: 5 * time.Minute,
	},
	{
		Condition:      "renderer_recreated",
		CriticalStates: []string{"recreated"},
		EnterEvent:     "renderer.recreated", ExitEvent: "",
		Severity: "warning", Cooldown: time.Minute,
	},
	{
		Condition:      "decoder_failed",
		CriticalStates: []string{"decoder_failure"},
		EnterEvent:     "decoder.failure", ExitEvent: "",
		Severity: "error", Cooldown: time.Minute,
	},
}

func (c telemetryStateCondition) holds(state string) bool {
	for _, critical := range c.CriticalStates {
		if state == critical {
			return true
		}
	}
	return false
}
