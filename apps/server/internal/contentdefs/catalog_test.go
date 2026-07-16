package contentdefs

import "testing"

func TestReleaseDefinitionsValidateAndFingerprintDeterministically(t *testing.T) {
	first, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	second, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if first.Fingerprint == "" || first.Fingerprint != second.Fingerprint {
		t.Fatal("content-definition fingerprint is not deterministic")
	}
	if _, ok := first.Widget("school-status-banner"); !ok {
		t.Fatal("School Status Banner definition is missing")
	}
	if _, ok := first.DataSource("school-status"); !ok {
		t.Fatal("School Status Data Source definition is missing")
	}
}

func TestCatalogRejectsDuplicateIDsAndUnsupportedControls(t *testing.T) {
	duplicate := &Catalog{
		Widgets: []WidgetDefinition{
			{ID: "same", Version: 1, Name: "One", Category: "Test", Runtime: "native", LegacyEditor: true, PresentationSchemaVersion: 1, RequiredCapabilities: map[string]int{"content.text": 1}},
			{ID: "same", Version: 1, Name: "Two", Category: "Test", Runtime: "native", LegacyEditor: true, PresentationSchemaVersion: 1, RequiredCapabilities: map[string]int{"content.text": 1}},
		},
		widgetsByID: map[string]WidgetDefinition{}, dataSourcesByID: map[string]DataSourceDefinition{},
	}
	if err := duplicate.validate(); err == nil {
		t.Fatal("duplicate definition ids were accepted")
	}
	unsupported := &Catalog{
		DataSources: []DataSourceDefinition{{
			ID: "bad", Version: 1, Name: "Bad", Category: "Test", AdapterID: "manual_object",
			ConfigurationSchema: ConfigurationSchema{Fields: []FieldDefinition{{Key: "script", Label: "Script", Control: "javascript"}}},
			OutputSchema:        OutputSchema{Kind: "object"},
		}},
		widgetsByID: map[string]WidgetDefinition{}, dataSourcesByID: map[string]DataSourceDefinition{},
	}
	if err := unsupported.validate(); err == nil {
		t.Fatal("unsupported form control was accepted")
	}
}
