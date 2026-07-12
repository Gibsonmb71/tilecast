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
