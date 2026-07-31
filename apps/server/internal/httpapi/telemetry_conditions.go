package httpapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// telemetryMeasurements pulls the numbers each threshold watches out of one
// sample. A measurement the player did not report is absent rather than zero:
// treating "not reported" as zero would fire a black-output event at every
// player that cannot measure luminance.
func telemetryMeasurements(input telemetrySampleInput) map[string]float64 {
	values := map[string]float64{}
	if input.PlaybackStallDurationMS != nil {
		values["playback_stalled"] = float64(*input.PlaybackStallDurationMS) / 1000
		// A frozen visual output is only meaningful where motion was expected;
		// a still image showing identical frames is doing its job.
		if input.ExpectedMotion != nil && *input.ExpectedMotion {
			values["visual_output_frozen"] = float64(*input.PlaybackStallDurationMS) / 1000
		}
	}
	if input.AverageLuminance != nil {
		values["black_output"] = float64(*input.AverageLuminance)
	}
	if input.ServerRoundTripMS != nil {
		values["network_latency_excessive"] = float64(*input.ServerRoundTripMS)
	}
	if input.Interval.ConsecutiveDownloadFailures > 0 || input.Interval.DownloadedBytes > 0 {
		values["download_failing"] = float64(input.Interval.ConsecutiveDownloadFailures)
	}
	if input.SyncGroupDriftMS != nil {
		drift := float64(*input.SyncGroupDriftMS)
		if drift < 0 {
			drift = -drift
		}
		values["sync_drift"] = drift
	}
	if input.CacheUsedBytes != nil && input.CacheLimitBytes != nil && *input.CacheLimitBytes > 0 {
		values["storage_pressure"] = float64(*input.CacheUsedBytes) / float64(*input.CacheLimitBytes) * 100
	}
	// Signal strength is only meaningful on a wireless link. A wired screen
	// reporting no radio must not be read as a screen with a weak one.
	if input.WifiSignalDBM != nil && input.NetworkLinkType == "wifi" {
		values["wifi_signal_weak"] = float64(*input.WifiSignalDBM)
	}
	if input.ClockOffsetSeconds != nil {
		offset := float64(*input.ClockOffsetSeconds)
		if offset < 0 {
			offset = -offset
		}
		values["clock_drift"] = offset
	}
	// A rate needs a denominator worth dividing by: one failed request in an
	// otherwise idle window is not a failing screen, so the measurement is
	// simply not produced below the minimum.
	if input.Interval.HTTPRequestCount >= telemetryMinimumRequestSample {
		failures := float64(input.Interval.HTTPFailureCount)
		values["request_failure_rate"] = failures / float64(input.Interval.HTTPRequestCount) * 100
	}
	return values
}

// Ten requests in a five-minute window is a normally active player; below that
// the failure rate is too coarse to act on.
const telemetryMinimumRequestSample = 10

type telemetryConditionState struct {
	Active      bool
	LastEventAt time.Time
	Known       bool
}

// evaluateTelemetryConditions turns a sample into events — but only for state
// that actually changed, and only when the cooldown for that condition has
// elapsed. Both guards matter: without the transition check every sample would
// emit an event, and without the cooldown a value oscillating across the
// hysteresis band would still produce a stream of them.
func (s *server) evaluateTelemetryConditions(
	r *http.Request, tx pgx.Tx, screenID uuid.UUID, input telemetrySampleInput, now time.Time,
) error {
	existing, err := readTelemetryConditions(r, tx, screenID)
	if err != nil {
		return err
	}

	for _, threshold := range telemetryThresholds {
		value, reported := telemetryMeasurements(input)[threshold.Condition]
		if !reported {
			continue
		}
		state := existing[threshold.Condition]
		enter, exit := threshold.crossed(value, state.Active)
		if !enter && !exit {
			// Inside the hysteresis band: the honest answer is "no change".
			continue
		}
		event := threshold.EnterEvent
		severity, result := threshold.Severity, "failed"
		if exit {
			event, severity, result = threshold.ExitEvent, "info", "recovered"
		}
		if err := s.applyTelemetryTransition(r, tx, screenID, telemetryTransition{
			Condition: threshold.Condition, Active: enter, Event: event,
			Severity: severity, Result: result, Cooldown: threshold.Cooldown,
			Value: &value, State: state, Now: now,
		}); err != nil {
			return err
		}
	}

	for _, condition := range telemetryStateConditions {
		state, reported := telemetryStateFor(input, condition.Condition)
		if !reported {
			continue
		}
		previous := existing[condition.Condition]
		holds := condition.holds(state)
		if holds == previous.Active && previous.Known {
			continue
		}
		event := condition.EnterEvent
		severity, result := condition.Severity, "failed"
		if !holds {
			if condition.ExitEvent == "" {
				// A momentary condition such as a renderer recreation has no
				// recovery event; clearing it silently is correct.
				if err := storeTelemetryCondition(r, tx, screenID, condition.Condition, false, previous.LastEventAt, now, false); err != nil {
					return err
				}
				continue
			}
			event, severity, result = condition.ExitEvent, "info", "recovered"
		}
		if err := s.applyTelemetryTransition(r, tx, screenID, telemetryTransition{
			Condition: condition.Condition, Active: holds, Event: event,
			Severity: severity, Result: result, Cooldown: condition.Cooldown,
			State: previous, Now: now, StateValue: state,
		}); err != nil {
			return err
		}
	}
	return nil
}

func telemetryStateFor(input telemetrySampleInput, condition string) (string, bool) {
	switch condition {
	case "memory_pressure_critical":
		return input.MemoryPressureState, input.MemoryPressureState != ""
	case "thermal_unsafe":
		return input.ThermalState, input.ThermalState != ""
	case "renderer_recreated", "decoder_failed":
		return input.RendererState, input.RendererState != ""
	case "display_disconnected":
		// A boolean becomes a state so that "not reported" stays distinct from
		// "reported connected". A player that cannot see its display at all must
		// not be treated as one reporting a fault.
		return telemetryBooleanState(input.DisplayConnected, "connected", "disconnected")
	case "captive_portal":
		return telemetryBooleanState(input.CaptivePortalSuspected, "suspected", "clear")
	case "software_decode_fallback":
		return input.VideoDecoderPath, input.VideoDecoderPath != ""
	default:
		return "", false
	}
}

func telemetryBooleanState(value *bool, whenTrue, whenFalse string) (string, bool) {
	if value == nil {
		return "", false
	}
	if *value {
		return whenTrue, true
	}
	return whenFalse, true
}

type telemetryTransition struct {
	Condition  string
	Active     bool
	Event      string
	Severity   string
	Result     string
	Cooldown   time.Duration
	Value      *float64
	StateValue string
	State      telemetryConditionState
	Now        time.Time
}

func (s *server) applyTelemetryTransition(
	r *http.Request, tx pgx.Tx, screenID uuid.UUID, transition telemetryTransition,
) error {
	// The condition itself is always recorded, even when the event is
	// suppressed, so the next sample compares against the truth.
	suppressed := transition.State.Known &&
		transition.Now.Sub(transition.State.LastEventAt) < transition.Cooldown
	lastEventAt := transition.State.LastEventAt
	if !suppressed && transition.Now.After(lastEventAt) {
		// Never moved backwards: a late-arriving sample must not reopen the
		// cooldown window for transitions that already happened.
		lastEventAt = transition.Now
	}
	if err := storeTelemetryCondition(r, tx, screenID, transition.Condition,
		transition.Active, lastEventAt, transition.Now, transition.Active); err != nil {
		return err
	}
	if suppressed {
		return nil
	}

	metadata := map[string]any{"condition": transition.Condition}
	if transition.Value != nil {
		metadata["value"] = *transition.Value
	}
	if transition.StateValue != "" {
		metadata["state"] = transition.StateValue
	}
	s.recordServerTransition(r, tx, screenID, playerActivityEventInput{
		ID: uuid.New(), EventType: transition.Event, Category: activityCategory(transition.Event),
		Severity: transition.Severity, OccurredAt: transition.Now, Result: transition.Result,
		Metadata: metadata, Priority: activityPriority(transition.Severity),
	})
	return nil
}

func readTelemetryConditions(r *http.Request, tx pgx.Tx, screenID uuid.UUID) (map[string]telemetryConditionState, error) {
	states := map[string]telemetryConditionState{}
	rows, err := tx.Query(r.Context(),
		`SELECT condition,active,last_event_at FROM screen_telemetry_conditions WHERE screen_id=$1`, screenID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return states, nil
		}
		return states, err
	}
	defer rows.Close()
	for rows.Next() {
		var condition string
		var state telemetryConditionState
		if rows.Scan(&condition, &state.Active, &state.LastEventAt) == nil {
			state.Known = true
			states[condition] = state
		}
	}
	return states, rows.Err()
}

func storeTelemetryCondition(
	r *http.Request, tx pgx.Tx, screenID uuid.UUID, condition string,
	active bool, lastEventAt, now time.Time, entered bool,
) error {
	var enteredAt, exitedAt any
	if entered {
		enteredAt = now
	} else {
		exitedAt = now
	}
	_, err := tx.Exec(r.Context(), `
		INSERT INTO screen_telemetry_conditions(screen_id,condition,active,entered_at,exited_at,last_event_at,occurrence_count)
		VALUES($1,$2,$3,$4,$5,$6,1)
		ON CONFLICT(screen_id,condition) DO UPDATE SET
			active=EXCLUDED.active,
			entered_at=COALESCE(EXCLUDED.entered_at,screen_telemetry_conditions.entered_at),
			exited_at=COALESCE(EXCLUDED.exited_at,screen_telemetry_conditions.exited_at),
			last_event_at=EXCLUDED.last_event_at,
			occurrence_count=screen_telemetry_conditions.occurrence_count
				+ CASE WHEN EXCLUDED.active AND NOT screen_telemetry_conditions.active THEN 1 ELSE 0 END`,
		screenID, condition, active, enteredAt, exitedAt, lastEventAt)
	return err
}
