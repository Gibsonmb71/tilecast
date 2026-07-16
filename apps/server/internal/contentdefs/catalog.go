package contentdefs

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

const CompilerVersion = "definition-compiler-v1"

var supportedControls = map[string]bool{
	"text": true, "multiline_text": true, "number": true, "integer": true,
	"boolean": true, "select": true, "color": true, "date": true,
	"datetime": true, "timezone": true, "url": true, "data_source": true,
	"data_source_field": true, "media_asset": true, "repeating_group": true,
}

var supportedNodes = map[string]bool{
	"surface": true, "box": true, "row": true, "column": true, "stack": true,
	"grid": true, "spacer": true, "divider": true, "text": true, "icon": true,
	"asset_image": true, "badge": true, "progress": true, "qr_code": true,
	"marquee": true, "line_chart": true, "bar_chart": true, "donut_chart": true,
	"repeat": true, "conditional": true, "grouped_sections": true,
}

//go:embed definitions/*.json
var definitionFiles embed.FS

type Catalog struct {
	Revision        string                 `json:"revision"`
	CompilerVersion string                 `json:"compilerVersion"`
	Widgets         []WidgetDefinition     `json:"widgets"`
	DataSources     []DataSourceDefinition `json:"dataSources"`
	Fingerprint     string                 `json:"fingerprint"`
	widgetsByID     map[string]WidgetDefinition
	dataSourcesByID map[string]DataSourceDefinition
}

type Deprecation struct {
	Deprecated  bool   `json:"deprecated"`
	Replacement string `json:"replacement,omitempty"`
	Message     string `json:"message,omitempty"`
}

type ConfigurationSchema struct {
	Fields []FieldDefinition `json:"fields"`
}

type FieldDefinition struct {
	Key                     string                 `json:"key"`
	Label                   string                 `json:"label"`
	Description             string                 `json:"description,omitempty"`
	Control                 string                 `json:"control"`
	Required                bool                   `json:"required,omitempty"`
	Default                 any                    `json:"default,omitempty"`
	Minimum                 *float64               `json:"minimum,omitempty"`
	Maximum                 *float64               `json:"maximum,omitempty"`
	MinLength               int                    `json:"minLength,omitempty"`
	MaxLength               int                    `json:"maxLength,omitempty"`
	Options                 []SelectOption         `json:"options,omitempty"`
	AcceptedDataSourceKinds []string               `json:"acceptedDataSourceKinds,omitempty"`
	RequiredFields          map[string]string      `json:"requiredFields,omitempty"`
	DataSourceFieldTypes    []string               `json:"dataSourceFieldTypes,omitempty"`
	MediaTypes              []string               `json:"mediaTypes,omitempty"`
	MaximumItems            int                    `json:"maximumItems,omitempty"`
	ItemFields              []FieldDefinition      `json:"itemFields,omitempty"`
	UI                      map[string]interface{} `json:"ui,omitempty"`
}

type SelectOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type OutputSchema struct {
	Kind   string        `json:"kind"`
	Fields []OutputField `json:"fields"`
}

type OutputField struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
}

type WidgetDefinition struct {
	ID                        string              `json:"id"`
	Version                   int                 `json:"version"`
	Name                      string              `json:"name"`
	Description               string              `json:"description"`
	Category                  string              `json:"category"`
	Icon                      string              `json:"icon"`
	Runtime                   string              `json:"runtime"`
	ConfigurationSchema       ConfigurationSchema `json:"configurationSchema"`
	DefaultConfiguration      map[string]any      `json:"defaultConfiguration"`
	AcceptedDataSourceKinds   []string            `json:"acceptedDataSourceKinds,omitempty"`
	RequiredFieldTypes        map[string]string   `json:"requiredFieldTypes,omitempty"`
	PresentationSchemaVersion int                 `json:"presentationSchemaVersion"`
	PresentationTemplate      json.RawMessage     `json:"presentationTemplate,omitempty"`
	RequiredCapabilities      map[string]int      `json:"requiredCapabilities"`
	EmptyStateBehavior        string              `json:"emptyStateBehavior"`
	LegacyEditor              bool                `json:"legacyEditor,omitempty"`
	RequiresManifestV13       bool                `json:"requiresManifestV13,omitempty"`
	Deprecation               Deprecation         `json:"deprecation"`
}

type DataSourceDefinition struct {
	ID                   string              `json:"id"`
	Version              int                 `json:"version"`
	Name                 string              `json:"name"`
	Description          string              `json:"description"`
	Category             string              `json:"category"`
	Icon                 string              `json:"icon"`
	ConfigurationSchema  ConfigurationSchema `json:"configurationSchema"`
	DefaultConfiguration map[string]any      `json:"defaultConfiguration"`
	OutputSchema         OutputSchema        `json:"outputSchema"`
	AdapterID            string              `json:"adapterId"`
	RefreshBehavior      string              `json:"refreshBehavior"`
	Attribution          string              `json:"attribution,omitempty"`
	LegacyEditor         bool                `json:"legacyEditor,omitempty"`
	Deprecation          Deprecation         `json:"deprecation"`
}

var (
	defaultOnce    sync.Once
	defaultCatalog *Catalog
	defaultErr     error
)

func Load() (*Catalog, error) {
	defaultOnce.Do(func() {
		defaultCatalog, defaultErr = load()
	})
	return defaultCatalog, defaultErr
}

func MustLoad() *Catalog {
	catalog, err := Load()
	if err != nil {
		panic(err)
	}
	return catalog
}

func load() (*Catalog, error) {
	names, err := definitionFiles.ReadDir("definitions")
	if err != nil {
		return nil, err
	}
	sort.Slice(names, func(i, j int) bool { return names[i].Name() < names[j].Name() })
	catalog := &Catalog{
		CompilerVersion: CompilerVersion,
		Widgets:         []WidgetDefinition{}, DataSources: []DataSourceDefinition{},
		widgetsByID: map[string]WidgetDefinition{}, dataSourcesByID: map[string]DataSourceDefinition{},
	}
	hasher := sha256.New()
	hasher.Write([]byte(CompilerVersion))
	for _, name := range names {
		if name.IsDir() || !strings.HasSuffix(name.Name(), ".json") {
			continue
		}
		raw, readErr := definitionFiles.ReadFile("definitions/" + name.Name())
		if readErr != nil {
			return nil, readErr
		}
		hasher.Write([]byte(name.Name()))
		hasher.Write(raw)
		var envelope struct {
			Widgets     []WidgetDefinition     `json:"widgets"`
			DataSources []DataSourceDefinition `json:"dataSources"`
		}
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, fmt.Errorf("%s: %w", name.Name(), err)
		}
		catalog.Widgets = append(catalog.Widgets, envelope.Widgets...)
		catalog.DataSources = append(catalog.DataSources, envelope.DataSources...)
	}
	if err := catalog.validate(); err != nil {
		return nil, err
	}
	catalog.Fingerprint = hex.EncodeToString(hasher.Sum(nil))
	catalog.Revision = catalog.Fingerprint[:16]
	return catalog, nil
}

func (c *Catalog) validate() error {
	for _, definition := range c.Widgets {
		if err := validateIdentity(definition.ID, definition.Version, definition.Name, definition.Category); err != nil {
			return fmt.Errorf("Widget definition %q: %w", definition.ID, err)
		}
		if _, exists := c.widgetsByID[definition.ID]; exists {
			return fmt.Errorf("duplicate Widget definition id %q", definition.ID)
		}
		if definition.Runtime != "native" && definition.Runtime != "web" {
			return fmt.Errorf("Widget definition %q has an invalid runtime", definition.ID)
		}
		if err := validateSchema(definition.ConfigurationSchema); err != nil {
			return fmt.Errorf("Widget definition %q: %w", definition.ID, err)
		}
		if err := validateDefaults(definition.ConfigurationSchema, definition.DefaultConfiguration); err != nil {
			return fmt.Errorf("Widget definition %q: %w", definition.ID, err)
		}
		if definition.PresentationSchemaVersion < 1 || len(definition.RequiredCapabilities) == 0 {
			return fmt.Errorf("Widget definition %q has invalid presentation requirements", definition.ID)
		}
		if !definition.LegacyEditor {
			if len(definition.PresentationTemplate) == 0 {
				return fmt.Errorf("Widget definition %q is missing a presentation template", definition.ID)
			}
			if err := validateTemplate(definition.PresentationTemplate, definition.ConfigurationSchema); err != nil {
				return fmt.Errorf("Widget definition %q: %w", definition.ID, err)
			}
		}
		c.widgetsByID[definition.ID] = definition
	}
	for _, definition := range c.DataSources {
		if err := validateIdentity(definition.ID, definition.Version, definition.Name, definition.Category); err != nil {
			return fmt.Errorf("Data Source definition %q: %w", definition.ID, err)
		}
		if _, exists := c.dataSourcesByID[definition.ID]; exists {
			return fmt.Errorf("duplicate Data Source definition id %q", definition.ID)
		}
		if definition.AdapterID == "" {
			return fmt.Errorf("Data Source definition %q is missing an adapter id", definition.ID)
		}
		if err := validateSchema(definition.ConfigurationSchema); err != nil {
			return fmt.Errorf("Data Source definition %q: %w", definition.ID, err)
		}
		if err := validateDefaults(definition.ConfigurationSchema, definition.DefaultConfiguration); err != nil {
			return fmt.Errorf("Data Source definition %q: %w", definition.ID, err)
		}
		if definition.OutputSchema.Kind != "scalar" && definition.OutputSchema.Kind != "records" &&
			definition.OutputSchema.Kind != "time_series" && definition.OutputSchema.Kind != "list" &&
			definition.OutputSchema.Kind != "object" {
			return fmt.Errorf("Data Source definition %q has an invalid output kind", definition.ID)
		}
		c.dataSourcesByID[definition.ID] = definition
	}
	return nil
}

func validateIdentity(id string, version int, name, category string) error {
	if id == "" || len(id) > 80 || strings.ToLower(id) != id || strings.ContainsAny(id, " /") {
		return errors.New("id is invalid")
	}
	if version < 1 || name == "" || category == "" {
		return errors.New("version, name, and category are required")
	}
	return nil
}

func validateSchema(schema ConfigurationSchema) error {
	seen := map[string]bool{}
	for _, field := range schema.Fields {
		if field.Key == "" || seen[field.Key] {
			return errors.New("configuration schema contains a missing or duplicate field key")
		}
		seen[field.Key] = true
		if !supportedControls[field.Control] {
			return fmt.Errorf("configuration schema uses unsupported form control %q", field.Control)
		}
		if field.Control == "select" && len(field.Options) == 0 {
			return fmt.Errorf("select field %q has no options", field.Key)
		}
		if field.Control == "repeating_group" {
			if field.MaximumItems < 1 || field.MaximumItems > 100 {
				return fmt.Errorf("repeating group %q has invalid bounds", field.Key)
			}
			if err := validateSchema(ConfigurationSchema{Fields: field.ItemFields}); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateDefaults(schema ConfigurationSchema, defaults map[string]any) error {
	fields := map[string]FieldDefinition{}
	for _, field := range schema.Fields {
		fields[field.Key] = field
	}
	for key, value := range defaults {
		field, ok := fields[key]
		if !ok {
			return fmt.Errorf("default configuration contains unknown field %q", key)
		}
		switch field.Control {
		case "boolean":
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("default %q must be boolean", key)
			}
		case "number", "integer":
			if _, ok := value.(float64); !ok {
				return fmt.Errorf("default %q must be numeric", key)
			}
		case "repeating_group":
			if _, ok := value.([]any); !ok {
				return fmt.Errorf("default %q must be a list", key)
			}
		default:
			if _, ok := value.(string); !ok {
				return fmt.Errorf("default %q must be text", key)
			}
		}
	}
	return nil
}

func validateTemplate(raw json.RawMessage, schema ConfigurationSchema) error {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return err
	}
	fields := map[string]FieldDefinition{}
	for _, field := range schema.Fields {
		fields[field.Key] = field
	}
	return walkTemplate(root, fields)
}

func walkTemplate(value any, fields map[string]FieldDefinition) error {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if err := walkTemplate(item, fields); err != nil {
				return err
			}
		}
	case map[string]any:
		if key, ok := typed["$config"].(string); ok {
			if _, exists := fields[key]; !exists {
				return fmt.Errorf("presentation template references unknown configuration %q", key)
			}
		}
		if key, ok := typed["$ifConfig"].(string); ok {
			field, exists := fields[key]
			if !exists || field.Control != "boolean" {
				return fmt.Errorf("presentation template condition %q is not a boolean configuration field", key)
			}
		}
		if nodeType, ok := typed["type"].(string); ok && !supportedNodes[nodeType] {
			return fmt.Errorf("presentation template uses unsupported node %q", nodeType)
		}
		for _, item := range typed {
			if err := walkTemplate(item, fields); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *Catalog) Widget(id string) (WidgetDefinition, bool) {
	definition, ok := c.widgetsByID[id]
	return definition, ok
}

func (c *Catalog) DataSource(id string) (DataSourceDefinition, bool) {
	definition, ok := c.dataSourcesByID[id]
	return definition, ok
}
