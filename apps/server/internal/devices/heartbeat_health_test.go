package devices

import (
	"testing"
	"time"
)

func TestEffectiveHealthyPlaybackAt(t *testing.T) {
	// A device clock running well behind the server's, which is what stranded
	// Linux players at "Installing": their reported timestamp could never be
	// later than the server-stamped install_started_at.
	behind := time.Now().UTC().Add(-90 * time.Minute)
	yes, no := true, false
	serverNow := func(at *time.Time) bool {
		return at != nil && time.Since(*at) < time.Minute
	}
	for _, testCase := range []struct {
		name      string
		heartbeat Heartbeat
		expect    func(*time.Time) bool
	}{
		{
			// Playing right now, observed here, so dated here — regardless of what
			// the device's clock says.
			name:      "a playing screen is dated with the server clock",
			heartbeat: Heartbeat{PlaybackState: "playing", SafeMode: &no, LastHealthyPlaybackAt: &behind},
			expect:    serverNow,
		},
		{
			// The Android socket status message: playing, but no timestamp field.
			name:      "playing without a reported timestamp still counts",
			heartbeat: Heartbeat{PlaybackState: "playing", SafeMode: &no},
			expect:    serverNow,
		},
		{
			// Not playing: the player's account of when it last did is all there is.
			name:      "an idle screen keeps the reported timestamp",
			heartbeat: Heartbeat{PlaybackState: "idle", LastHealthyPlaybackAt: &behind},
			expect:    func(at *time.Time) bool { return at != nil && at.Equal(behind) },
		},
		{
			name:      "idle with nothing reported is not evidence",
			heartbeat: Heartbeat{PlaybackState: "idle"},
			expect:    func(at *time.Time) bool { return at == nil },
		},
		{
			name:      "a heartbeat with no playback state is not evidence",
			heartbeat: Heartbeat{},
			expect:    func(at *time.Time) bool { return at == nil },
		},
		{
			// Safe mode is something on screen, but it is a recovery state, not a
			// settled update. It must not be dated as healthy playback.
			name:      "safe mode is not evidence",
			heartbeat: Heartbeat{PlaybackState: "playing", SafeMode: &yes},
			expect:    func(at *time.Time) bool { return at == nil },
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if got := effectiveHealthyPlaybackAt(testCase.heartbeat); !testCase.expect(got) {
				t.Fatalf("unexpected healthy playback timestamp: %v", got)
			}
		})
	}
}
