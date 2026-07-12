package devices

import (
	"testing"
	"time"
)

func TestComputeStatus(t *testing.T) {
	now := time.Now()
	recent := now.Add(-time.Minute)
	stale := now.Add(-5 * time.Minute)
	offline := now.Add(-time.Hour)
	tests := []struct {
		name                        string
		socket, enabled, credential bool
		contact                     *time.Time
		want                        Status
	}{
		{"online", true, true, true, nil, StatusOnline},
		{"recent", false, true, true, &recent, StatusRecent},
		{"stale", false, true, true, &stale, StatusStale},
		{"offline", false, true, true, &offline, StatusOffline},
		{"disabled", true, false, true, &recent, StatusDisabled},
		{"revoked", true, true, false, &recent, StatusRevoked},
	}
	for _, test := range tests {
		if got := ComputeStatus(now, test.socket, test.enabled, test.credential, test.contact); got != test.want {
			t.Errorf("%s: got %s want %s", test.name, got, test.want)
		}
	}
}
