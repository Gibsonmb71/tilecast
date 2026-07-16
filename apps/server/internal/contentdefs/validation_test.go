package contentdefs

import (
	"encoding/json"
	"testing"
)

// validReleaseWidget returns a minimal, valid release-defined Widget definition that each
// negative test mutates to exercise exactly one validation rule.
func validReleaseWidget() WidgetDefinition {
	return WidgetDefinition{
		ID: "test-banner", Version: 1, Name: "Test Banner", Category: "Test",
		Runtime:                   "native",
		PresentationSchemaVersion: 1,
		RequiredCapabilities:      map[string]int{"layout.surface": 1, "content.text": 1},
		ConfigurationSchema: ConfigurationSchema{Fields: []FieldDefinition{
			{Key: "heading", Label: "Heading", Control: "text"},
		}},
		DefaultConfiguration: map[string]any{},
		PresentationTemplate: json.RawMessage(`{"type":"surface","children":[{"type":"text","binding":{"source":"literal","value":{"$config":"heading"}}}]}`),
	}
}

func validManualObjectSource() DataSourceDefinition {
	return DataSourceDefinition{
		ID: "test-object", Version: 1, Name: "Test Object", Category: "Test",
		AdapterID:            "manual_object",
		ConfigurationSchema:  ConfigurationSchema{Fields: []FieldDefinition{{Key: "status", Label: "Status", Control: "text"}}},
		DefaultConfiguration: map[string]any{},
		OutputSchema:         OutputSchema{Kind: "object", Fields: []OutputField{{Key: "status", Label: "Status", Type: "text"}}},
	}
}

func expectWidgetError(t *testing.T, mutate func(*WidgetDefinition), rule string) {
	t.Helper()
	widget := validReleaseWidget()
	mutate(&widget)
	if _, err := New([]WidgetDefinition{widget}, nil); err == nil {
		t.Fatalf("expected %s to be rejected", rule)
	}
}

func expectSourceError(t *testing.T, mutate func(*DataSourceDefinition), rule string) {
	t.Helper()
	source := validManualObjectSource()
	mutate(&source)
	if _, err := New(nil, []DataSourceDefinition{source}); err == nil {
		t.Fatalf("expected %s to be rejected", rule)
	}
}

func TestValidBaselineDefinitionsAreAccepted(t *testing.T) {
	if _, err := New([]WidgetDefinition{validReleaseWidget()}, []DataSourceDefinition{validManualObjectSource()}); err != nil {
		t.Fatalf("baseline definitions were rejected: %v", err)
	}
}

func TestOutputSchemaValidation(t *testing.T) {
	expectSourceError(t, func(s *DataSourceDefinition) {
		s.OutputSchema.Fields = append(s.OutputSchema.Fields, OutputField{Key: "status", Label: "Dup", Type: "text"})
	}, "duplicate output field keys")
	expectSourceError(t, func(s *DataSourceDefinition) {
		s.OutputSchema.Fields[0].Type = "script"
	}, "unsupported output field type")
}

func TestCapabilityValidation(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.RequiredCapabilities = map[string]int{"content.hologram": 1}
	}, "invalid capability name")
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.RequiredCapabilities = map[string]int{"content.text": 0, "layout.surface": 1}
	}, "capability version below 1")
}

func TestMissingRequiredCapabilityForUsedNode(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		// Uses a badge node but declares no content.badge capability.
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":[{"type":"badge","binding":{"source":"literal","value":"x"}}]}`)
	}, "missing required capability for used node")
}

func TestUnknownBindingSource(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":[{"type":"text","binding":{"source":"remote"}}]}`)
	}, "unknown binding source")
}

func TestUnknownConditionOperator(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.RequiredCapabilities["collection.conditional"] = 2
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":[{"type":"conditional","condition":{"op":"contains","binding":{"source":"literal","value":"x"}},"children":[]}]}`)
	}, "unknown condition operator")
}

func TestInvalidDatasetReference(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":[{"type":"text","binding":{"source":"dataset","path":"x"}}]}`)
	}, "dataset binding without a dataset reference")
}

func TestInvalidNodeStructure(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":{"type":"text"}}`)
	}, "children that are not a list")
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":["text"]}`)
	}, "child node that is not an object")
}

func TestExcessivePresentationDepth(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		node := `{"type":"text"}`
		for i := 0; i < maxPresentationDepth+2; i++ {
			node = `{"type":"box","children":[` + node + `]}`
		}
		w.RequiredCapabilities["layout.box"] = 1
		w.PresentationTemplate = json.RawMessage(node)
	}, "excessive presentation depth")
}

func TestExcessiveNodeCount(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		children := ""
		for i := 0; i < maxPresentationNodes+2; i++ {
			if i > 0 {
				children += ","
			}
			children += `{"type":"text"}`
		}
		w.PresentationTemplate = json.RawMessage(`{"type":"surface","children":[` + children + `]}`)
	}, "excessive node count")
}

func TestEmptyRepeatingGroup(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.ConfigurationSchema.Fields = append(w.ConfigurationSchema.Fields, FieldDefinition{
			Key: "rows", Label: "Rows", Control: "repeating_group", MaximumItems: 5, ItemFields: nil,
		})
	}, "empty repeating group")
}

func TestInvalidNumericBounds(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		min, max := 10.0, 1.0
		w.ConfigurationSchema.Fields = append(w.ConfigurationSchema.Fields, FieldDefinition{
			Key: "count", Label: "Count", Control: "number", Minimum: &min, Maximum: &max,
		})
	}, "invalid numeric bounds")
}

func TestInvalidStringBounds(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.ConfigurationSchema.Fields = append(w.ConfigurationSchema.Fields, FieldDefinition{
			Key: "label", Label: "Label", Control: "text", MinLength: 20, MaxLength: 5,
		})
	}, "invalid string bounds")
}

func TestInvalidSelectDefault(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.ConfigurationSchema.Fields = append(w.ConfigurationSchema.Fields, FieldDefinition{
			Key: "mode", Label: "Mode", Control: "select", Default: "gamma",
			Options: []SelectOption{{Value: "alpha", Label: "Alpha"}, {Value: "beta", Label: "Beta"}},
		})
	}, "invalid select default")
}

func TestRequiredFieldWithEmptyDefault(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.ConfigurationSchema.Fields = append(w.ConfigurationSchema.Fields, FieldDefinition{
			Key: "title", Label: "Title", Control: "text", Required: true, Default: "",
		})
	}, "required field with empty default")
}

func TestInvalidDeprecationReplacement(t *testing.T) {
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.Deprecation = Deprecation{Deprecated: true, Replacement: "does-not-exist"}
	}, "deprecation replacement that does not exist")
	expectWidgetError(t, func(w *WidgetDefinition) {
		w.Deprecation = Deprecation{Deprecated: true, Replacement: w.ID}
	}, "deprecation replacement referencing itself")
}
