package contentdefs

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
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

// DerivedConfigurationKeys are configuration keys a presentation template may reference
// that the Server derives during manifest projection rather than the author entering
// them. They are never part of a configuration schema, are never accepted from a client,
// and resolve to an empty value when projection did not produce one.
var DerivedConfigurationKeys = map[string]bool{
	// Written by playlist manifest projection from the author's imageAssetId selection.
	"imageVariantId": true,
}

// supportedOutputFieldTypes bounds the typed values a Data Source may declare. The set
// mirrors the scalar kinds the Player's Data Document projector understands.
var supportedOutputFieldTypes = map[string]bool{
	"text": true, "number": true, "integer": true, "percent": true, "currency": true,
	"boolean": true, "date": true, "datetime": true, "duration": true, "url": true, "asset": true,
}

// supportedCapabilities enumerates every presentation capability a Widget may require.
// It must stay in agreement with the Player's declared native capabilities and the web
// runtime capability; unknown names are rejected at startup.
var supportedCapabilities = map[string]bool{
	"layout.surface": true, "layout.box": true, "layout.row": true, "layout.column": true,
	"layout.stack": true, "layout.grid": true, "layout.spacer": true, "layout.divider": true,
	"content.text": true, "content.icon": true, "content.asset_image": true, "content.badge": true,
	"content.progress": true, "content.qr_code": true, "content.marquee": true,
	"content.line_chart": true, "content.bar_chart": true, "content.donut_chart": true,
	"collection.repeat": true, "collection.conditional": true, "collection.grouped_sections": true,
	"binding.core": true, "format.typed": true, "selection.relative_date": true,
	"environment.time": true, "web.remote": true,
}

// supportedBindingSources and supportedConditionOperators mirror the vocabularies the
// Player enforces in ManifestSyncManager, keeping Server validation and Player playback
// in agreement.
var supportedBindingSources = map[string]bool{
	"literal": true, "dataset": true, "repeat": true, "repeat_index": true, "environment": true,
}

var supportedConditionOperators = map[string]bool{
	"equals": true, "not_equals": true, "empty": true, "not_empty": true,
	"greater_than": true, "greater_or_equal": true, "less_than": true, "less_or_equal": true,
	"before": true, "after": true,
}

// Conservative, documented bounds on release-defined presentation templates. They keep
// compiled presentations small enough to verify, cache, and render offline on the Player.
const (
	maxPresentationDepth = 24
	maxPresentationNodes = 256
)

// nodeCapability maps a presentation node type to the capability a definition must
// declare to use it, or "" for structural nodes that need no explicit declaration.
func nodeCapability(nodeType string) string {
	switch nodeType {
	case "surface", "box", "row", "column", "stack", "grid", "spacer", "divider":
		return "layout." + nodeType
	case "repeat", "conditional", "grouped_sections":
		return "collection." + nodeType
	case "text", "icon", "asset_image", "badge", "progress", "qr_code", "marquee",
		"line_chart", "bar_chart", "donut_chart":
		return "content." + nodeType
	default:
		return ""
	}
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

// Setup carries optional Studio presentation copy for a release-defined definition, so the
// gallery and editor can render provider-specific guidance without hardcoded Studio code.
type Setup struct {
	Eyebrow    string   `json:"eyebrow,omitempty"`
	Tip        string   `json:"tip,omitempty"`
	Steps      []string `json:"steps,omitempty"`
	EmptyState string   `json:"emptyState,omitempty"`
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

// FetchSpec pins how a release-defined Data Source reaches a public endpoint and how the
// response becomes typed records. The release owns the endpoint and the field mapping; the
// author only fills in the placeholders the definition declares.
//
// The template's scheme and host are fixed by the release and may not contain a
// placeholder, so an author can never point a definition at a different service. Every
// request still passes the Server's normal source-fetch policy, which enforces the private
// network, size, redirect, and timeout limits.
type FetchSpec struct {
	// URLTemplate is an absolute HTTPS URL whose path and query may contain {key}
	// placeholders naming configuration fields.
	URLTemplate string `json:"urlTemplate"`
	// Format is "json" or "csv".
	Format string `json:"format"`
	Accept string `json:"accept,omitempty"`
	// RecordsPath is a dot path to the JSON array holding the records. Empty means the
	// document itself is the array. It is unused for CSV.
	RecordsPath string `json:"recordsPath,omitempty"`
	// Mapping maps an output-schema field key to a dot path within one record (JSON) or a
	// column name (CSV).
	Mapping        map[string]string `json:"mapping"`
	MaximumRecords int               `json:"maximumRecords,omitempty"`
	RefreshSeconds int               `json:"refreshSeconds,omitempty"`
}

// placeholderPattern matches the {key} placeholders a FetchSpec URL template may contain.
var placeholderPattern = regexp.MustCompile(`\{([a-zA-Z][a-zA-Z0-9_]*)\}`)

// FetchPlaceholders returns the configuration keys a URL template substitutes.
func (spec FetchSpec) FetchPlaceholders() []string {
	matches := placeholderPattern.FindAllStringSubmatch(spec.URLTemplate, -1)
	keys := make([]string, 0, len(matches))
	seen := map[string]bool{}
	for _, match := range matches {
		if seen[match[1]] {
			continue
		}
		seen[match[1]] = true
		keys = append(keys, match[1])
	}
	return keys
}

type OutputField struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Required bool   `json:"required,omitempty"`
}

type WidgetDefinition struct {
	ID          string `json:"id"`
	Version     int    `json:"version"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Icon        string `json:"icon"`
	// Thumbnail names the Studio catalog preview drawn for this Widget. Studio falls back
	// to a generic preview when the name is empty or unknown, so a definition never has to
	// ship one and an unknown name never breaks the gallery.
	Thumbnail                 string              `json:"thumbnail,omitempty"`
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
	Setup                     Setup               `json:"setup,omitempty"`
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
	Fetch                *FetchSpec          `json:"fetch,omitempty"`
	AdapterID            string              `json:"adapterId"`
	RefreshBehavior      string              `json:"refreshBehavior"`
	Attribution          string              `json:"attribution,omitempty"`
	LegacyEditor         bool                `json:"legacyEditor,omitempty"`
	RequiresManifestV13  bool                `json:"requiresManifestV13,omitempty"`
	Setup                Setup               `json:"setup,omitempty"`
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

// New builds a catalog from explicit definitions. It validates the definitions and
// derives a deterministic fingerprint, mirroring the embedded loader. It exists so
// callers (and tests) can inject an alternate catalog through dependency injection
// instead of relying on the embedded default.
func New(widgets []WidgetDefinition, dataSources []DataSourceDefinition) (*Catalog, error) {
	catalog := &Catalog{
		CompilerVersion: CompilerVersion,
		Widgets:         widgets,
		DataSources:     dataSources,
		widgetsByID:     map[string]WidgetDefinition{},
		dataSourcesByID: map[string]DataSourceDefinition{},
	}
	if catalog.Widgets == nil {
		catalog.Widgets = []WidgetDefinition{}
	}
	if catalog.DataSources == nil {
		catalog.DataSources = []DataSourceDefinition{}
	}
	if err := catalog.validate(); err != nil {
		return nil, err
	}
	hasher := sha256.New()
	hasher.Write([]byte(CompilerVersion))
	encoded, err := json.Marshal(struct {
		Widgets     []WidgetDefinition     `json:"widgets"`
		DataSources []DataSourceDefinition `json:"dataSources"`
	}{catalog.Widgets, catalog.DataSources})
	if err != nil {
		return nil, err
	}
	hasher.Write(encoded)
	catalog.Fingerprint = hex.EncodeToString(hasher.Sum(nil))
	catalog.Revision = catalog.Fingerprint[:16]
	return catalog, nil
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
		if err := validateCapabilities(definition.RequiredCapabilities); err != nil {
			return fmt.Errorf("Widget definition %q: %w", definition.ID, err)
		}
		if !definition.LegacyEditor {
			if len(definition.PresentationTemplate) == 0 {
				return fmt.Errorf("Widget definition %q is missing a presentation template", definition.ID)
			}
			if err := validateTemplate(definition.PresentationTemplate, definition.ConfigurationSchema, definition.RequiredCapabilities); err != nil {
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
		if err := validateOutputSchema(definition.OutputSchema); err != nil {
			return fmt.Errorf("Data Source definition %q: %w", definition.ID, err)
		}
		if definition.Fetch != nil {
			if err := validateFetchSpec(*definition.Fetch, definition.ConfigurationSchema, definition.OutputSchema); err != nil {
				return fmt.Errorf("Data Source definition %q: %w", definition.ID, err)
			}
		}
		c.dataSourcesByID[definition.ID] = definition
	}
	for _, definition := range c.Widgets {
		if err := validateDeprecation("Widget", definition.ID, definition.Deprecation, func(id string) bool { _, ok := c.widgetsByID[id]; return ok }); err != nil {
			return err
		}
	}
	for _, definition := range c.DataSources {
		if err := validateDeprecation("Data Source", definition.ID, definition.Deprecation, func(id string) bool { _, ok := c.dataSourcesByID[id]; return ok }); err != nil {
			return err
		}
	}
	return nil
}

// validateOutputSchema rejects duplicate output field keys and unsupported field types.
func validateOutputSchema(schema OutputSchema) error {
	seen := map[string]bool{}
	for _, field := range schema.Fields {
		if field.Key == "" || seen[field.Key] {
			return errors.New("output schema contains a missing or duplicate field key")
		}
		seen[field.Key] = true
		if !supportedOutputFieldTypes[field.Type] {
			return fmt.Errorf("output field %q uses unsupported type %q", field.Key, field.Type)
		}
	}
	return nil
}

// Bounds on a release-defined fetch specification. They keep one refresh small enough to
// parse and cache on a modest self-hosted server.
const (
	maxFetchRecords     = 500
	minFetchRefresh     = 60
	maxFetchPathSegment = 200
)

// validateFetchSpec rejects a fetch specification that could reach an endpoint the release
// did not pin, or that maps fields the output schema does not declare.
func validateFetchSpec(spec FetchSpec, schema ConfigurationSchema, output OutputSchema) error {
	if spec.Format != "json" && spec.Format != "csv" {
		return fmt.Errorf("fetch format %q is not supported", spec.Format)
	}
	parsed, err := url.Parse(spec.URLTemplate)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return errors.New("fetch url template must be an absolute HTTPS URL")
	}
	// The scheme and host are the release's guarantee about which service is contacted, so
	// neither may be author-controlled.
	if strings.ContainsAny(parsed.Host, "{}") || strings.ContainsAny(parsed.Scheme, "{}") {
		return errors.New("fetch url template may not place a placeholder in its scheme or host")
	}
	if parsed.User != nil {
		return errors.New("fetch url template may not carry credentials")
	}
	fields := map[string]FieldDefinition{}
	for _, field := range schema.Fields {
		fields[field.Key] = field
	}
	for _, key := range spec.FetchPlaceholders() {
		field, ok := fields[key]
		if !ok {
			return fmt.Errorf("fetch url template references unknown configuration %q", key)
		}
		switch field.Control {
		case "text", "select", "integer", "number":
		default:
			return fmt.Errorf("fetch url placeholder %q must name a text, select, integer, or number field", key)
		}
		if field.Control == "text" && (field.MaxLength <= 0 || field.MaxLength > maxFetchPathSegment) {
			return fmt.Errorf("fetch url placeholder %q must declare a maximum length of 1 to %d", key, maxFetchPathSegment)
		}
	}
	if len(spec.Mapping) == 0 {
		return errors.New("fetch specification declares no field mapping")
	}
	declared := map[string]bool{}
	for _, field := range output.Fields {
		declared[field.Key] = true
	}
	for key, path := range spec.Mapping {
		if !declared[key] {
			return fmt.Errorf("fetch mapping targets undeclared output field %q", key)
		}
		if path == "" || len(path) > 200 || strings.ContainsAny(path, "{}") {
			return fmt.Errorf("fetch mapping for %q is not a plain path", key)
		}
	}
	if spec.RecordsPath != "" && (len(spec.RecordsPath) > 200 || strings.ContainsAny(spec.RecordsPath, "{}")) {
		return errors.New("fetch records path is not a plain path")
	}
	if spec.MaximumRecords < 0 || spec.MaximumRecords > maxFetchRecords {
		return fmt.Errorf("fetch maximum record count must be between 0 and %d", maxFetchRecords)
	}
	if spec.RefreshSeconds != 0 && spec.RefreshSeconds < minFetchRefresh {
		return fmt.Errorf("fetch refresh interval must be at least %d seconds", minFetchRefresh)
	}
	return nil
}

// validateCapabilities rejects unknown capability names and versions below one.
func validateCapabilities(capabilities map[string]int) error {
	for name, version := range capabilities {
		if !supportedCapabilities[name] {
			return fmt.Errorf("declares unknown capability %q", name)
		}
		if version < 1 {
			return fmt.Errorf("capability %q must require version 1 or higher", name)
		}
	}
	return nil
}

// validateDeprecation rejects a deprecation whose replacement points at a definition of
// the same kind that does not exist, and a replacement that points back at itself.
func validateDeprecation(kind, id string, deprecation Deprecation, exists func(string) bool) error {
	if deprecation.Replacement == "" {
		return nil
	}
	if deprecation.Replacement == id {
		return fmt.Errorf("%s definition %q deprecation replacement cannot reference itself", kind, id)
	}
	if !exists(deprecation.Replacement) {
		return fmt.Errorf("%s definition %q deprecation replacement %q does not exist", kind, id, deprecation.Replacement)
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
		if err := validateFieldBounds(field); err != nil {
			return err
		}
		if field.Control == "select" {
			if len(field.Options) == 0 {
				return fmt.Errorf("select field %q has no options", field.Key)
			}
			if err := validateSelectDefault(field); err != nil {
				return err
			}
		}
		if field.Required {
			if text, ok := field.Default.(string); ok && strings.TrimSpace(text) == "" {
				return fmt.Errorf("required field %q declares an empty default", field.Key)
			}
		}
		if field.Control == "repeating_group" {
			if field.MaximumItems < 1 || field.MaximumItems > 100 {
				return fmt.Errorf("repeating group %q has invalid bounds", field.Key)
			}
			if len(field.ItemFields) == 0 {
				return fmt.Errorf("repeating group %q declares no item fields", field.Key)
			}
			if err := validateSchema(ConfigurationSchema{Fields: field.ItemFields}); err != nil {
				return err
			}
		}
	}
	return nil
}

// validateFieldBounds rejects contradictory numeric and string bounds.
func validateFieldBounds(field FieldDefinition) error {
	if field.Minimum != nil && field.Maximum != nil && *field.Minimum > *field.Maximum {
		return fmt.Errorf("field %q has a minimum greater than its maximum", field.Key)
	}
	if field.MinLength < 0 || field.MaxLength < 0 {
		return fmt.Errorf("field %q has a negative length bound", field.Key)
	}
	if field.MaxLength > 0 && field.MinLength > field.MaxLength {
		return fmt.Errorf("field %q has a minimum length greater than its maximum length", field.Key)
	}
	return nil
}

// validateSelectDefault rejects a select default that is not one of its options.
func validateSelectDefault(field FieldDefinition) error {
	if field.Default == nil {
		return nil
	}
	value, ok := field.Default.(string)
	if !ok {
		return fmt.Errorf("select field %q default must be text", field.Key)
	}
	for _, option := range field.Options {
		if option.Value == value {
			return nil
		}
	}
	return fmt.Errorf("select field %q default is not one of its options", field.Key)
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

func validateTemplate(raw json.RawMessage, schema ConfigurationSchema, capabilities map[string]int) error {
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return err
	}
	fields := map[string]FieldDefinition{}
	for _, field := range schema.Fields {
		fields[field.Key] = field
	}
	if err := walkTemplate(root, fields); err != nil {
		return err
	}
	used := map[string]bool{}
	count := 0
	if err := validateTemplateNode(root, 1, &count, used); err != nil {
		return err
	}
	// Every node type the template renders must have its capability declared, so the
	// Player can reject content it cannot present rather than failing at render time.
	for nodeType := range used {
		capability := nodeCapability(nodeType)
		if capability == "" {
			continue
		}
		if _, declared := capabilities[capability]; !declared {
			return fmt.Errorf("presentation uses node %q but does not declare required capability %q", nodeType, capability)
		}
	}
	return nil
}

// validateTemplateNode enforces the presentation node structure: each node is an object
// with a supported type, bounded nesting depth and total count, well-formed bindings and
// conditions, and list-typed children.
func validateTemplateNode(value any, depth int, count *int, used map[string]bool) error {
	if depth > maxPresentationDepth {
		return fmt.Errorf("presentation template exceeds the maximum depth of %d", maxPresentationDepth)
	}
	node, ok := value.(map[string]any)
	if !ok {
		return errors.New("presentation template node is not an object")
	}
	nodeType, ok := node["type"].(string)
	if !ok || !supportedNodes[nodeType] {
		return fmt.Errorf("presentation template node has a missing or unsupported type")
	}
	used[nodeType] = true
	*count++
	if *count > maxPresentationNodes {
		return fmt.Errorf("presentation template exceeds the maximum of %d nodes", maxPresentationNodes)
	}
	if binding, present := node["binding"]; present {
		if err := validateTemplateBinding(binding); err != nil {
			return err
		}
	}
	if condition, present := node["condition"]; present {
		if err := validateTemplateCondition(condition); err != nil {
			return err
		}
	}
	if children, present := node["children"]; present {
		list, ok := children.([]any)
		if !ok {
			return errors.New("presentation template children must be a list")
		}
		for _, child := range list {
			if err := validateTemplateNode(child, depth+1, count, used); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateTemplateBinding(value any) error {
	binding, ok := value.(map[string]any)
	if !ok {
		return errors.New("presentation binding is not an object")
	}
	source, ok := binding["source"].(string)
	if !ok || !supportedBindingSources[source] {
		return errors.New("presentation binding has a missing or unknown source")
	}
	if source == "dataset" {
		if _, present := binding["dataset"]; !present {
			return errors.New("dataset binding is missing a dataset reference")
		}
	}
	return nil
}

func validateTemplateCondition(value any) error {
	condition, ok := value.(map[string]any)
	if !ok {
		return errors.New("presentation condition is not an object")
	}
	op, ok := condition["op"].(string)
	if !ok || !supportedConditionOperators[op] {
		return errors.New("presentation condition has a missing or unknown operator")
	}
	binding, present := condition["binding"]
	if !present {
		return errors.New("presentation condition is missing a binding")
	}
	return validateTemplateBinding(binding)
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
			if _, exists := fields[key]; !exists && !DerivedConfigurationKeys[key] {
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
