package settings

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRegistryRejectsUnknownAndUnsafeValues(t *testing.T) {
	if _, err := Validate(map[string]any{"arbitrary.key": true}, ScopeOrganization); err == nil {
		t.Fatal("unknown key accepted")
	}
	if _, err := Validate(map[string]any{"player.sync.status_seconds": 1.0}, ScopePolicy); err == nil {
		t.Fatal("unsafe reporting interval accepted")
	}
	if _, err := Validate(map[string]any{"preference.appearance": "dark"}, ScopePreference); err != nil {
		t.Fatal(err)
	}
}

func TestDefinitionJSONUsesPublicContractFieldNames(t *testing.T) {
	encoded, err := json.Marshal(Definitions()[0])
	if err != nil {
		t.Fatal(err)
	}
	jsonText := string(encoded)
	for _, field := range []string{`"key"`, `"category"`, `"scope"`, `"default"`} {
		if !strings.Contains(jsonText, field) {
			t.Fatalf("definition JSON %s does not contain %s", jsonText, field)
		}
	}
	if strings.Contains(jsonText, `"Key"`) || strings.Contains(jsonText, `"Category"`) {
		t.Fatalf("definition JSON exposes Go field names: %s", jsonText)
	}
}

func TestReliabilityPoliciesAreTypedAndBounded(t *testing.T) {
	valid := map[string]any{
		"reliability.mode":               "managed_kiosk",
		"power.active_hours_timezone":    "America/New_York",
		"power.active_hours_days":        []any{1.0, 2.0, 5.0},
		"power.active_hours_start":       "22:00",
		"power.active_hours_end":         "02:00",
		"accessibility.allowed_packages": []any{"com.example.maintenance"},
	}
	if _, err := Validate(valid, ScopePolicy); err != nil {
		t.Fatal(err)
	}
	for name, values := range map[string]map[string]any{
		"bad timezone":      {"power.active_hours_timezone": "EST+5"},
		"bad local time":    {"power.active_hours_start": "25:30"},
		"duplicate weekday": {"power.active_hours_days": []any{1.0, 1.0}},
		"unsafe package":    {"accessibility.allowed_packages": []any{"../settings"}},
		"restart loop":      {"reliability.maximum_process_restarts": 99.0},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Validate(values, ScopePolicy); err == nil {
				t.Fatal("unsafe reliability policy accepted")
			}
		})
	}
}
