package snapshots

import (
	"context"
	"errors"
	"testing"

	"github.com/tilecast/tilecast/apps/server/internal/settings"
)

type stubSettings struct {
	values map[string]any
	err    error
}

func (s stubSettings) Organization(context.Context) (settings.Document, error) {
	return settings.Document{Values: s.values}, s.err
}

func policyFrom(values map[string]any) Policy {
	return NewService(nil, stubSettings{values: values}, nil, nil).Policy(context.Background())
}

func TestSnapshotsAreOffByDefault(t *testing.T) {
	// Storing screen images without being asked would grow every backup.
	if policyFrom(map[string]any{}).Enabled {
		t.Error("snapshot history must default to off")
	}
}

func TestDefaultsAreConservative(t *testing.T) {
	policy := policyFrom(map[string]any{})
	if policy.IntervalMinutes != 60 || policy.RetentionDays != 7 || policy.MaxPerScreen != 48 {
		t.Errorf("defaults = %+v", policy)
	}
}

func TestPolicyReadsConfiguredValues(t *testing.T) {
	policy := policyFrom(map[string]any{
		"snapshots.enabled":          true,
		"snapshots.interval_minutes": float64(15),
		"snapshots.retention_days":   float64(30),
		"snapshots.max_per_screen":   float64(100),
	})
	if !policy.Enabled || policy.IntervalMinutes != 15 ||
		policy.RetentionDays != 30 || policy.MaxPerScreen != 100 {
		t.Errorf("policy = %+v", policy)
	}
}

func TestZeroValuesFallBackRatherThanDisablingTheCaps(t *testing.T) {
	// A zero interval would capture continuously and a zero cap would keep
	// nothing; neither is a plausible intent, and one of them fills the disk.
	policy := policyFrom(map[string]any{
		"snapshots.enabled":          true,
		"snapshots.interval_minutes": float64(0),
		"snapshots.max_per_screen":   float64(0),
		"snapshots.retention_days":   float64(0),
	})
	if policy.IntervalMinutes != 60 || policy.MaxPerScreen != 48 || policy.RetentionDays != 7 {
		t.Errorf("policy = %+v, want the defaults", policy)
	}
}

func TestUnreadableSettingsLeaveSnapshotsOff(t *testing.T) {
	policy := NewService(nil, stubSettings{err: errors.New("unreachable")}, nil, nil).
		Policy(context.Background())
	if policy.Enabled {
		t.Error("a settings failure must not start storing images")
	}
}
