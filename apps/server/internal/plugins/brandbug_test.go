package plugins

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func validBrandBug() BrandBugInput {
	return BrandBugInput{
		Name: "Sponsor mark", Corner: "top_right", Text: "Presented by Example",
		WidthPercent: 12, TextSizePercent: 3, OpacityPercent: 85, MarginPercent: 3,
		TextColor: "#FFFFFF", BackgroundStyle: "scrim", Enabled: true,
		TargetScope: "all", TargetIDs: []uuid.UUID{},
	}
}

func TestValidateBrandBug(t *testing.T) {
	if err := validateBrandBug(validBrandBug()); err != nil {
		t.Fatalf("valid text mark rejected: %v", err)
	}
	imageOnly := validBrandBug()
	imageOnly.Text = "   "
	assetID := uuid.New()
	imageOnly.ImageAssetID = &assetID
	if err := validateBrandBug(imageOnly); err != nil {
		t.Fatalf("valid logo-only mark rejected: %v", err)
	}
	window := validBrandBug()
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(72 * time.Hour)
	window.StartsAt, window.EndsAt = &start, &end
	if err := validateBrandBug(window); err != nil {
		t.Fatalf("valid campaign window rejected: %v", err)
	}
}

func TestValidateBrandBugRejectsEmptyMark(t *testing.T) {
	input := validBrandBug()
	input.Text = "  "
	if err := validateBrandBug(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected a mark with no logo and no text to be invalid, got %v", err)
	}
}

func TestValidateBrandBugRejectsInvalidPresentation(t *testing.T) {
	cases := map[string]func(*BrandBugInput){
		"corner":           func(i *BrandBugInput) { i.Corner = "middle" },
		"color":            func(i *BrandBugInput) { i.TextColor = "white" },
		"short color":      func(i *BrandBugInput) { i.TextColor = "#fff" },
		"background":       func(i *BrandBugInput) { i.BackgroundStyle = "blur" },
		"width too small":  func(i *BrandBugInput) { i.WidthPercent = 1 },
		"width too large":  func(i *BrandBugInput) { i.WidthPercent = 41 },
		"text size":        func(i *BrandBugInput) { i.TextSizePercent = 0 },
		"opacity":          func(i *BrandBugInput) { i.OpacityPercent = 5 },
		"margin":           func(i *BrandBugInput) { i.MarginPercent = 21 },
		"priority":         func(i *BrandBugInput) { i.Priority = 1001 },
		"name":             func(i *BrandBugInput) { i.Name = " " },
		"nil asset":        func(i *BrandBugInput) { i.ImageAssetID = &uuid.Nil },
		"scoped no target": func(i *BrandBugInput) { i.TargetScope = "screens" },
	}
	for name, mutate := range cases {
		input := validBrandBug()
		mutate(&input)
		if err := validateBrandBug(input); !errors.Is(err, ErrInvalid) {
			t.Errorf("expected %s to be invalid, got %v", name, err)
		}
	}
}

func TestValidateBrandBugRejectsBackwardWindow(t *testing.T) {
	input := validBrandBug()
	start := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	end := start.Add(-time.Hour)
	input.StartsAt, input.EndsAt = &start, &end
	if err := validateBrandBug(input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected endsAt before startsAt to be invalid, got %v", err)
	}
	same := validBrandBug()
	same.StartsAt, same.EndsAt = &start, &start
	if err := validateBrandBug(same); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected a zero-length window to be invalid, got %v", err)
	}
}
