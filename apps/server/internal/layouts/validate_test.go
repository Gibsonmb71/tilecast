package layouts

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func validTestDocument() Document {
	return Document{
		SchemaVersion: 2,
		Canvas:        Canvas{Width: 1920, Height: 1080, Orientation: "landscape", BackgroundColor: "#101820", SafeAreaPercent: 5},
		Placements: []Placement{{
			ID: uuid.New(), Type: "primitive", Name: "Heading", X: 80, Y: 80, Width: 900, Height: 180,
			Layer: 1, Opacity: 1, Visible: true, Primitive: &Primitive{Kind: "text", Text: "Welcome", FontFamily: "Inter", FontSize: 72, FontWeight: 700, Color: "#FFFFFF"},
		}},
	}
}

func TestValidateDocumentRestrictsAppPlacementOverrides(t *testing.T) {
	document := validTestDocument()
	appID := uuid.New()
	document.Placements = []Placement{{ID: uuid.New(), Type: "widget", Name: "Clock", X: 0, Y: 0, Width: 400, Height: 200, Layer: 1, Opacity: 1, Visible: true, WidgetID: &appID, Overrides: json.RawMessage(`{"fit":"contain","alignment":"center"}`)}}
	if err := ValidateDocument(document); err != nil {
		t.Fatal(err)
	}
	document.Placements[0].Overrides = json.RawMessage(`{"javascript":"alert(1)"}`)
	if err := ValidateDocument(document); err == nil {
		t.Fatal("unsupported App override was accepted")
	}
}

func TestValidateDocumentAcceptsRendererNeutralPrimitive(t *testing.T) {
	if err := ValidateDocument(validTestDocument()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateDocumentRejectsBespokeOrEscapingPlacement(t *testing.T) {
	document := validTestDocument()
	document.Placements[0].Type = "clock"
	if err := ValidateDocument(document); err == nil {
		t.Fatal("bespoke clock placement was accepted")
	}
	document = validTestDocument()
	document.Placements[0].X = 1900
	if err := ValidateDocument(document); err == nil {
		t.Fatal("placement outside canvas was accepted")
	}
}

func TestDependenciesAreTypedAndDeduplicated(t *testing.T) {
	document := validTestDocument()
	appID, assetID := uuid.New(), uuid.New()
	document.Placements = append(document.Placements,
		Placement{ID: uuid.New(), Type: "widget", Name: "Clock", X: 0, Y: 0, Width: 200, Height: 100, Opacity: 1, Visible: true, WidgetID: &appID},
		Placement{ID: uuid.New(), Type: "widget", Name: "Clock copy", X: 200, Y: 0, Width: 200, Height: 100, Opacity: 1, Visible: true, WidgetID: &appID},
		Placement{ID: uuid.New(), Type: "asset", Name: "Logo", X: 0, Y: 200, Width: 200, Height: 100, Opacity: 1, Visible: true, AssetID: &assetID},
	)
	dependencies := Dependencies(document)
	if len(dependencies) != 2 || dependencies[0].Type != "widget" || dependencies[1].Type != "asset" {
		t.Fatalf("dependencies=%#v", dependencies)
	}
}
