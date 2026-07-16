package media

import (
	"reflect"
	"testing"
)

func TestValidateWidgetTextScale(t *testing.T) {
	tooSmall, minimum, maximum, tooLarge := 49, 50, 200, 201
	for _, scale := range []*int{nil, &minimum, &maximum} {
		if err := validateWidgetTextScale(scale); err != nil {
			t.Fatalf("validateWidgetTextScale(%v): %v", scale, err)
		}
	}
	for _, scale := range []*int{&tooSmall, &tooLarge} {
		if err := validateWidgetTextScale(scale); err == nil {
			t.Fatalf("validateWidgetTextScale(%d) unexpectedly succeeded", *scale)
		}
	}
}

func TestNormalizeDisplayWidgetFieldsDropsStaleMenuDefaults(t *testing.T) {
	fields, err := normalizeDisplayWidgetFields(
		"menu",
		[]string{"title", "subtitle", "option_1", "option_2"},
		map[string]bool{"date": true, "option_1": true, "option_2": true},
	)
	if err != nil {
		t.Fatalf("normalize fields: %v", err)
	}
	want := []string{"option_1", "option_2"}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("fields = %#v, want %#v", fields, want)
	}
}

func TestNormalizeDisplayWidgetFieldsChoosesMenuValues(t *testing.T) {
	fields, err := normalizeDisplayWidgetFields(
		"menu",
		[]string{"title", "subtitle"},
		map[string]bool{"date": true, "option_1": true, "option_2": true},
	)
	if err != nil {
		t.Fatalf("normalize fields: %v", err)
	}
	want := []string{"option_1", "option_2"}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("fields = %#v, want %#v", fields, want)
	}
}

func TestNormalizeDisplayWidgetFieldsStillRejectsUnknownMenuFields(t *testing.T) {
	_, err := normalizeDisplayWidgetFields(
		"menu",
		[]string{"not_a_real_field"},
		map[string]bool{"option_1": true, "option_2": true},
	)
	if err == nil {
		t.Fatal("expected unknown field to be rejected")
	}
}

func TestNormalizeDisplayWidgetFieldsDoesNotRelaxOtherWidgets(t *testing.T) {
	_, err := normalizeDisplayWidgetFields(
		"table",
		[]string{"title"},
		map[string]bool{"option_1": true},
	)
	if err == nil {
		t.Fatal("expected unavailable table field to be rejected")
	}
}
