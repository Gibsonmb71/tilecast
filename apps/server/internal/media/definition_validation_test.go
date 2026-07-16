package media

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
)

func TestSchoolStatusDefinitionValidationIsGeneric(t *testing.T) {
	definition, ok := contentdefs.MustLoad().DataSource("school-status")
	if !ok {
		t.Fatal("School Status definition is missing")
	}
	normalizer := definitionConfigNormalizer{schema: definition.ConfigurationSchema}
	normalized, err := normalizer.Normalize(context.Background(), json.RawMessage(`{
		"status":"Delayed","message":"Opening at 10:00 AM","severity":"notice",
		"effectiveAt":"","expiresAt":""
	}`))
	if err != nil {
		t.Fatal(err)
	}
	values := normalized.(map[string]any)
	if values["severity"] != "notice" {
		t.Fatalf("unexpected normalized configuration: %#v", values)
	}
	if _, err = normalizer.Normalize(context.Background(), json.RawMessage(`{"status":"Open","message":"Normal","severity":"invalid","unknown":true}`)); err == nil {
		t.Fatal("unknown key or invalid enum was accepted")
	}
}
