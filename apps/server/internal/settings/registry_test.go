package settings

import "testing"

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
