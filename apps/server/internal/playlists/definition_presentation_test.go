package playlists

import (
	"encoding/json"
	"testing"

	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
)

// TestEveryReleaseWidgetCompilesFromItsDefaults compiles every release-defined Widget in
// the embedded catalog using nothing but its own declared default configuration. It is the
// standing guard for declarative Widgets: a template that references a configuration key
// the schema does not supply a value for, uses a node the definition forgot to declare, or
// resolves to nothing at all fails here rather than at manifest generation on a screen.
func TestEveryReleaseWidgetCompilesFromItsDefaults(t *testing.T) {
	catalog := contentdefs.MustLoad()
	declarative := 0
	for _, definition := range catalog.Widgets {
		if definition.LegacyEditor {
			continue
		}
		declarative++
		t.Run(definition.ID, func(t *testing.T) {
			configuration := make(map[string]any, len(definition.DefaultConfiguration))
			for key, value := range definition.DefaultConfiguration {
				configuration[key] = value
			}
			if definition.Runtime == "web" && definition.WebIntegration != nil {
				host := "example.com"
				if len(definition.WebIntegration.AllowedHosts) > 0 {
					host = definition.WebIntegration.AllowedHosts[0]
				}
				path := definition.WebIntegration.RequiredPathPrefix
				switch definition.WebIntegration.Transform {
				case "google_sheets":
					path = "/spreadsheets/d/1234567890abcdef/edit"
				case "google_slides":
					path = "/presentation/d/1234567890abcdef/edit"
				case "canva_embed":
					path = "/design/1234567890abcdef/view"
				}
				configuration[definition.WebIntegration.URLField] = "https://" + host + path
				if definition.WebIntegration.AllowAnyHTTPSHost {
					configuration["trustedHost"] = host
				}
			}
			raw, err := json.Marshal(configuration)
			if err != nil {
				t.Fatal(err)
			}
			presentation, err := compileDefinitionPresentation(definition, raw)
			if err != nil {
				t.Fatalf("compile from defaults: %v", err)
			}
			if definition.Runtime == "web" {
				if presentation.Kind != "web" || presentation.Web == nil {
					t.Fatalf("expected a web presentation, got %#v", presentation)
				}
				return
			}
			if presentation.Kind != "native" || presentation.Native == nil {
				t.Fatalf("expected a native presentation, got %#v", presentation)
			}
			if presentation.Native.Root.Type == "" {
				t.Fatal("compiled presentation has no root node type")
			}
			// The Player rejects a presentation requiring a capability it does not declare,
			// so every node the compiled tree actually contains must be covered.
			used := map[string]bool{}
			collectNodeTypes(&presentation.Native.Root, used)
			for nodeType := range used {
				capability := presentationNodeCapability(nodeType)
				if capability == "" {
					continue
				}
				if _, declared := presentation.RequiredCapabilities[capability]; !declared {
					t.Fatalf("compiled tree uses node %q without declaring capability %q", nodeType, capability)
				}
			}
		})
	}
	if declarative == 0 {
		t.Fatal("expected the embedded catalog to contain release-defined Widgets")
	}
}

// TestStandaloneReleaseWidgetCompilesWithoutADataSource proves the declarative path does
// not require a data_source control: a Widget whose bindings are entirely literal compiles
// to a complete tree. Studio's Essentials definitions depend on this.
func TestStandaloneReleaseWidgetCompilesWithoutADataSource(t *testing.T) {
	catalog := contentdefs.MustLoad()
	definition, ok := catalog.Widget("text-notice")
	if !ok {
		t.Fatal("text-notice definition is missing")
	}
	presentation, err := compileDefinitionPresentation(definition, json.RawMessage(`{"heading":"Welcome","body":"Hello"}`))
	if err != nil {
		t.Fatal(err)
	}
	if presentation.Native == nil || presentation.Native.Root.Type == "" {
		t.Fatalf("expected standalone native presentation, got %#v", presentation)
	}
}
