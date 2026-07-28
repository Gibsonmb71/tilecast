package httpapi

import (
	"testing"
	"time"
)

func pointerTo[T any](value T) *T { return &value }

// A healthy screen is the only combination that clears every check, so the
// other cases are written as one deviation from this baseline.
func healthySignals(now time.Time) fleetScreenSignals {
	heartbeat := now.Add(-30 * time.Second)
	return fleetScreenSignals{
		LastHeartbeatAt: &heartbeat,
		HasStatus:       true,
		PlaybackState:   "playing",
		ForegroundState: "foreground",
		ActiveManifest:  pointerTo(int64(4)),
		CacheUsedBytes:  pointerTo(int64(10)),
		CacheLimitBytes: pointerTo(int64(100)),
	}
}

func TestClassifyFleetScreen(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-fleetHeartbeatGrace - time.Minute)

	cases := []struct {
		name   string
		mutate func(*fleetScreenSignals)
		state  string
		reason string
	}{
		{"confirmed playback", func(*fleetScreenSignals) {}, fleetStateHealthy, "playing"},
		{
			"never reported",
			func(s *fleetScreenSignals) { s.LastHeartbeatAt = nil },
			fleetStateUnmeasured, "never_reported",
		},
		{
			"past the heartbeat grace period",
			func(s *fleetScreenSignals) { s.LastHeartbeatAt = &stale },
			fleetStateOffline, "heartbeat_grace_exceeded",
		},
		{
			"reporting without a status document",
			func(s *fleetScreenSignals) { s.HasStatus = false },
			fleetStateUnmeasured, "no_player_status",
		},
		{
			"safe mode",
			func(s *fleetScreenSignals) { s.SafeMode = true },
			fleetStateImpaired, "safe_mode",
		},
		{
			"active playback error",
			func(s *fleetScreenSignals) { s.PlaybackError = "codec failed" },
			fleetStateImpaired, "playback_error",
		},
		{
			"pushed to the background",
			func(s *fleetScreenSignals) { s.ForegroundState = "background" },
			fleetStateImpaired, "not_in_foreground",
		},
		{
			"storage pressure",
			func(s *fleetScreenSignals) { s.CacheUsedBytes = pointerTo(int64(95)) },
			fleetStateImpaired, "storage_pressure",
		},
		{
			"synchronization error",
			func(s *fleetScreenSignals) { s.SyncError = "download failed" },
			fleetStateImpaired, "synchronization_error",
		},
		{
			"reporting but not playing",
			func(s *fleetScreenSignals) { s.PlaybackState = "idle" },
			fleetStateImpaired, "playback_not_confirmed",
		},
		{
			"off hours",
			func(s *fleetScreenSignals) { s.PlaybackState = "off_hours" },
			fleetStateUnmeasured, "playback_not_expected",
		},
		{
			"playback stopped administratively",
			func(s *fleetScreenSignals) { s.PlaybackDisable = true },
			fleetStateUnmeasured, "playback_not_expected",
		},
		{
			"no manifest assigned yet",
			func(s *fleetScreenSignals) { s.ActiveManifest = nil },
			fleetStateUnmeasured, "playback_not_expected",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			signals := healthySignals(now)
			testCase.mutate(&signals)
			state, reason := classifyFleetScreen(now, signals)
			if state != testCase.state || reason != testCase.reason {
				t.Fatalf("got %s/%s, want %s/%s", state, reason, testCase.state, testCase.reason)
			}
		})
	}
}

// A recent heartbeat is reachability, not health. This is the specific claim
// the previous "screens reporting normally" count made and could not support.
func TestRecentHeartbeatAloneIsNotHealthy(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	heartbeat := now.Add(-10 * time.Second)
	state, _ := classifyFleetScreen(now, fleetScreenSignals{LastHeartbeatAt: &heartbeat})
	if state == fleetStateHealthy {
		t.Fatal("a heartbeat with no player status must not count as healthy")
	}
}

// Android and Linux spell the same conditions differently; Activity must not
// classify one platform as impaired for a state the other calls correct.
func TestNormalizePlaybackStateAcrossPlayers(t *testing.T) {
	cases := map[string]string{
		"playing":          "playing",
		"safe_mode":        "safe_mode",
		"safe-mode":        "safe_mode",
		"SAFE-MODE":        "safe_mode",
		"off_hours":        "off_hours",
		"sleep":            "off_hours",
		"disabled":         "disabled",
		"idle":             "idle",
		"starting":         "idle",
		"pairing":          "idle",
		"setup":            "idle",
		"offline-capable":  "idle",
		"":                 "",
		"  playing  ":      "playing",
		"future_new_state": "idle",
	}
	for input, want := range cases {
		if got := normalizePlaybackState(input); got != want {
			t.Errorf("normalizePlaybackState(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSafeModeReportedByEitherSignal(t *testing.T) {
	now := time.Date(2026, 7, 27, 12, 0, 0, 0, time.UTC)
	signals := healthySignals(now)
	signals.PlaybackState = "safe-mode"
	if state, reason := classifyFleetScreen(now, signals); state != fleetStateImpaired || reason != "safe_mode" {
		t.Fatalf("Linux safe-mode playback state got %s/%s", state, reason)
	}
}
