package plugins

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func validInput() CountdownBarInput {
	target := "12:00"
	return CountdownBarInput{
		Name: "Lunch", Message: "Lunch ends in", ScheduleType: "weekly",
		TargetTime: &target, DaysOfWeek: []int{1, 2, 3, 4, 5},
		Timezone: "America/New_York", LeadTimeSeconds: 900,
		DisplayMode: "overlay", HeightPX: 72, ProgressFill: "none", Enabled: true,
		TargetScope: "all", TargetIDs: []uuid.UUID{},
	}
}

func TestValidateCountdownBar(t *testing.T) {
	if err := validateCountdownBar(validInput()); err != nil {
		t.Fatalf("valid weekly input rejected: %v", err)
	}
	drain := validInput()
	drain.ProgressFill = "drain"
	if err := validateCountdownBar(drain); err != nil {
		t.Fatalf("draining fill rejected: %v", err)
	}
	omitted := validInput()
	omitted.ProgressFill = ""
	if err := validateCountdownBar(normalizeCountdownBar(omitted)); err != nil {
		t.Fatalf("omitted progressFill should default to none, got %v", err)
	}
	if got := normalizeCountdownBar(omitted).ProgressFill; got != "none" {
		t.Fatalf("expected omitted progressFill to normalize to none, got %q", got)
	}
	oneTime := validInput()
	oneTime.ScheduleType = "one_time"
	oneTime.TargetTime = nil
	oneTime.DaysOfWeek = nil
	at := time.Date(2026, 8, 1, 16, 0, 0, 0, time.UTC)
	oneTime.OneTimeAt = &at
	if err := validateCountdownBar(oneTime); err != nil {
		t.Fatalf("valid one-time input rejected: %v", err)
	}
}

func TestValidateCountdownBarRejectsInvalidScheduleAndTargets(t *testing.T) {
	input := validInput()
	input.DaysOfWeek = []int{1, 1}
	if err := validateCountdownBar(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected duplicate days to be invalid, got %v", err)
	}
	input = validInput()
	input.TargetScope = "screens"
	if err := validateCountdownBar(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected empty screen targets to be invalid, got %v", err)
	}
	input = validInput()
	input.TargetScope = "screens"
	duplicate := uuid.New()
	input.TargetIDs = []uuid.UUID{duplicate, duplicate}
	if err := validateCountdownBar(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected duplicate targets to be invalid, got %v", err)
	}
	input = validInput()
	input.ProgressFill = "sideways"
	if err := validateCountdownBar(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected an unknown progressFill to be rejected, got %v", err)
	}
	input = validInput()
	input.Timezone = "not/a-zone"
	if err := validateCountdownBar(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected invalid timezone to be rejected, got %v", err)
	}
}
