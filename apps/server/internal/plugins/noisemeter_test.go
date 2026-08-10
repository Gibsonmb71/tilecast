package plugins

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func validNoiseMeter() NoiseMeterInput {
	return NoiseMeterInput{
		Name: "Cafeteria noise", Message: "Please lower the volume",
		WarningLevel: 60, LoudLevel: 80, Sensitivity: 100,
		TriggerHoldMS: 1000, ClearHoldMS: 3000,
		DisplayMode: "overlay", HeightPX: 96, Enabled: true,
		HistoryEnabled: true, HistoryRetentionDays: 7, HistoryActiveHoursOnly: true,
		TargetScope: "all", TargetIDs: []uuid.UUID{},
	}
}

func TestValidateNoiseMeter(t *testing.T) {
	if err := validateNoiseMeter(validNoiseMeter()); err != nil {
		t.Fatalf("valid meter rejected: %v", err)
	}
	// The message is optional; the bar falls back to its own TOO LOUD label.
	silent := validNoiseMeter()
	silent.Message = ""
	if err := validateNoiseMeter(silent); err != nil {
		t.Fatalf("meter without a message rejected: %v", err)
	}
	push := validNoiseMeter()
	push.DisplayMode = "push"
	if err := validateNoiseMeter(push); err != nil {
		t.Fatalf("push display mode rejected: %v", err)
	}
}

func TestNormalizeNoiseMeterFillsDefaults(t *testing.T) {
	defaults := normalizeNoiseMeter(NoiseMeterInput{Name: "Room", TargetScope: "all"})
	if defaults.WarningLevel != 60 || defaults.LoudLevel != 80 || defaults.Sensitivity != 100 ||
		defaults.TriggerHoldMS != 1000 || defaults.ClearHoldMS != 3000 ||
		defaults.HeightPX != 96 || defaults.DisplayMode != "overlay" ||
		defaults.HistoryRetentionDays != 7 {
		t.Fatalf("unexpected noise meter defaults: %#v", defaults)
	}
	if err := validateNoiseMeter(defaults); err != nil {
		t.Fatalf("defaults must be a valid instance, got %v", err)
	}
}

func TestValidateNoiseMeterRejectsOutOfRange(t *testing.T) {
	cases := map[string]func(*NoiseMeterInput){
		"name":                func(i *NoiseMeterInput) { i.Name = " " },
		"warning too low":     func(i *NoiseMeterInput) { i.WarningLevel = 0 },
		"warning too high":    func(i *NoiseMeterInput) { i.WarningLevel = 100 },
		"loud too low":        func(i *NoiseMeterInput) { i.LoudLevel = 1 },
		"loud too high":       func(i *NoiseMeterInput) { i.LoudLevel = 101 },
		"sensitivity floor":   func(i *NoiseMeterInput) { i.Sensitivity = 24 },
		"sensitivity ceiling": func(i *NoiseMeterInput) { i.Sensitivity = 301 },
		"trigger floor":       func(i *NoiseMeterInput) { i.TriggerHoldMS = 99 },
		"trigger ceiling":     func(i *NoiseMeterInput) { i.TriggerHoldMS = 10_001 },
		"clear floor":         func(i *NoiseMeterInput) { i.ClearHoldMS = 499 },
		"clear ceiling":       func(i *NoiseMeterInput) { i.ClearHoldMS = 30_001 },
		"display mode":        func(i *NoiseMeterInput) { i.DisplayMode = "corner" },
		"height floor":        func(i *NoiseMeterInput) { i.HeightPX = 39 },
		"height ceiling":      func(i *NoiseMeterInput) { i.HeightPX = 321 },
		"retention window":    func(i *NoiseMeterInput) { i.HistoryRetentionDays = 10 },
		"retention negative":  func(i *NoiseMeterInput) { i.HistoryRetentionDays = -7 },
		"scoped no target":    func(i *NoiseMeterInput) { i.TargetScope = "screens" },
	}
	for name, mutate := range cases {
		input := validNoiseMeter()
		mutate(&input)
		if err := validateNoiseMeter(input); !errors.Is(err, ErrInvalid) {
			t.Errorf("expected %s to be invalid, got %v", name, err)
		}
	}
}

// Showing and hiding must never share one threshold: that is exactly what makes
// a bar flap on and off while a room hovers around a single level.
func TestValidateNoiseMeterRequiresSeparateThresholds(t *testing.T) {
	equal := validNoiseMeter()
	equal.WarningLevel, equal.LoudLevel = 70, 70
	if err := validateNoiseMeter(equal); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected equal thresholds to be invalid, got %v", err)
	}
	inverted := validNoiseMeter()
	inverted.WarningLevel, inverted.LoudLevel = 85, 80
	if err := validateNoiseMeter(inverted); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected a warning level above the loud level to be invalid, got %v", err)
	}
}

func TestValidateNoiseMeterRejectsLongMessage(t *testing.T) {
	input := validNoiseMeter()
	input.Message = string(make([]byte, 121))
	if err := validateNoiseMeter(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected an over-length message to be invalid, got %v", err)
	}
}
