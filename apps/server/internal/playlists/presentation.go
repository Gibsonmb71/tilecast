package playlists

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	DataDocumentSchemaVersion      = 1
	PresentationSchemaVersion      = 1
	WebRuntimeVersion              = 1
	presentationCatalogFingerprint = "v13-data1-presentation1-builtins-2026-07-16"
)

var NativePresentationCapabilities = map[string]int{
	"layout.surface": 1, "layout.box": 1, "layout.row": 1, "layout.column": 1,
	"layout.stack": 1, "layout.grid": 1, "layout.spacer": 1, "layout.divider": 1,
	"content.text": 1, "content.icon": 1, "content.asset_image": 1, "content.badge": 1,
	"content.progress": 1, "content.qr_code": 1, "content.marquee": 1,
	"content.line_chart": 1, "content.bar_chart": 1, "content.donut_chart": 1,
	"collection.repeat": 1, "collection.conditional": 1, "collection.grouped_sections": 1,
	"binding.core": 1, "format.typed": 1, "selection.relative_date": 1,
}

type DataDocument struct {
	SchemaVersion int               `json:"schemaVersion"`
	Datasets      []DocumentDataset `json:"datasets"`
}

type DocumentDataset struct {
	ID            string                 `json:"id"`
	Kind          string                 `json:"kind"`
	Fields        []DocumentField        `json:"fields,omitempty"`
	Scalar        *DocumentValue         `json:"scalar,omitempty"`
	Records       []DocumentRecord       `json:"records,omitempty"`
	Points        []DocumentPoint        `json:"points,omitempty"`
	Value         *DocumentValue         `json:"value,omitempty"`
	Cache         DocumentCacheState     `json:"cache"`
	Attribution   string                 `json:"attribution,omitempty"`
	Timezone      string                 `json:"timezone,omitempty"`
	DateSelection *DocumentDateSelection `json:"dateSelection,omitempty"`
	Units         map[string]string      `json:"units,omitempty"`
}

type DocumentField struct {
	Key      string `json:"key"`
	Label    string `json:"label"`
	Type     string `json:"type"`
	Unit     string `json:"unit,omitempty"`
	Currency string `json:"currency,omitempty"`
}

type DocumentRecord struct {
	ID     string                   `json:"id"`
	Values map[string]DocumentValue `json:"values"`
}

type DocumentPoint struct {
	At    string        `json:"at"`
	Value DocumentValue `json:"value"`
}

type DocumentValue struct {
	Kind     string                   `json:"kind"`
	Text     *string                  `json:"text,omitempty"`
	Number   *float64                 `json:"number,omitempty"`
	Integer  *int64                   `json:"integer,omitempty"`
	Boolean  *bool                    `json:"boolean,omitempty"`
	Date     *string                  `json:"date,omitempty"`
	DateTime *string                  `json:"datetime,omitempty"`
	Duration *int64                   `json:"durationSeconds,omitempty"`
	URL      *string                  `json:"url,omitempty"`
	AssetID  *string                  `json:"assetId,omitempty"`
	List     []DocumentValue          `json:"list,omitempty"`
	Object   map[string]DocumentValue `json:"object,omitempty"`
}

type DocumentCacheState struct {
	CachedAt       *time.Time `json:"cachedAt,omitempty"`
	StaleAt        *time.Time `json:"staleAt,omitempty"`
	UsingCached    bool       `json:"usingCachedData"`
	Unavailable    bool       `json:"unavailable"`
	LastModified   string     `json:"lastModified,omitempty"`
	UpstreamExpiry *time.Time `json:"upstreamExpiry,omitempty"`
}

type DocumentDateSelection struct {
	Field           string `json:"field"`
	Timezone        string `json:"timezone"`
	Mode            string `json:"mode"`
	CustomStartDate string `json:"customStartDate,omitempty"`
	CustomEndDate   string `json:"customEndDate,omitempty"`
	ExcludePast     bool   `json:"excludePast"`
	NoMatchBehavior string `json:"noMatchBehavior,omitempty"`
	FallbackText    string `json:"fallbackText,omitempty"`
}

type WidgetPresentation struct {
	SchemaVersion        int                     `json:"schemaVersion"`
	Kind                 string                  `json:"kind"`
	RequiredCapabilities map[string]int          `json:"requiredCapabilities"`
	Native               *NativePresentation     `json:"native,omitempty"`
	Web                  *WebSandboxPresentation `json:"web,omitempty"`
}

type NativePresentation struct {
	Root PresentationNode `json:"root"`
}

type PresentationNode struct {
	ID        string                 `json:"id,omitempty"`
	Type      string                 `json:"type"`
	Props     map[string]any         `json:"props,omitempty"`
	Binding   *PresentationBinding   `json:"binding,omitempty"`
	Repeat    *PresentationRepeat    `json:"repeat,omitempty"`
	Condition *PresentationCondition `json:"condition,omitempty"`
	Children  []PresentationNode     `json:"children,omitempty"`
}

type PresentationBinding struct {
	Source    string   `json:"source"`
	Dataset   string   `json:"dataset,omitempty"`
	Path      string   `json:"path,omitempty"`
	Value     string   `json:"value,omitempty"`
	Fields    []string `json:"fields,omitempty"`
	Format    string   `json:"format,omitempty"`
	Precision *int     `json:"precision,omitempty"`
	Prefix    string   `json:"prefix,omitempty"`
	Suffix    string   `json:"suffix,omitempty"`
	Fallback  string   `json:"fallback,omitempty"`
	Separator string   `json:"separator,omitempty"`
}

type PresentationRepeat struct {
	Dataset string `json:"dataset"`
	Limit   int    `json:"limit"`
}

type PresentationCondition struct {
	Binding PresentationBinding `json:"binding"`
	Op      string              `json:"op"`
	Value   string              `json:"value,omitempty"`
}

type WebSandboxPresentation struct {
	Mode                  string   `json:"mode"`
	URL                   string   `json:"url,omitempty"`
	BundleID              string   `json:"bundleId,omitempty"`
	EntryPoint            string   `json:"entryPoint,omitempty"`
	IntegritySHA256       string   `json:"integritySha256,omitempty"`
	PackageSize           int64    `json:"packageSize,omitempty"`
	DownloadPath          string   `json:"downloadPath,omitempty"`
	AllowedHosts          []string `json:"allowedHosts"`
	ExternalNetworkAccess bool     `json:"externalNetworkAccess"`
	OnlineOnly            bool     `json:"onlineOnly"`
	FallbackBehavior      string   `json:"fallbackBehavior"`
	LoadTimeoutSeconds    int      `json:"loadTimeoutSeconds"`
	Lifecycle             string   `json:"lifecycle"`
	WarmSeconds           int      `json:"warmSeconds"`
}

type typedRecordProjection struct {
	Fields []struct {
		Key   string `json:"key"`
		Label string `json:"label"`
		Type  string `json:"type"`
	} `json:"fields"`
	Records []struct {
		ID     string            `json:"id"`
		Values map[string]string `json:"values"`
	} `json:"records"`
	CachedAt      *time.Time `json:"cachedAt"`
	StaleAt       *time.Time `json:"staleAt"`
	UsingCached   bool       `json:"usingCachedData"`
	Unavailable   bool       `json:"unavailable"`
	DateSelection *struct {
		Timezone        string `json:"timezone"`
		Mode            string `json:"mode"`
		CustomStartDate string `json:"customStartDate"`
		CustomEndDate   string `json:"customEndDate"`
		ExcludePast     bool   `json:"excludePast"`
		NoMatchBehavior string `json:"noMatchBehavior"`
		FallbackText    string `json:"fallbackText"`
	} `json:"dateSelection"`
	DateField   string `json:"dateField"`
	Attribution string `json:"attribution"`
}

func projectDataDocument(raw json.RawMessage) (*DataDocument, error) {
	var projected typedRecordProjection
	if err := json.Unmarshal(raw, &projected); err != nil {
		return nil, fmt.Errorf("decode projected data: %w", err)
	}
	if len(projected.Fields) > 16 || len(projected.Records) > 2000 {
		return nil, errors.New("projected data exceeds v13 bounds")
	}
	dataset := DocumentDataset{
		ID: "records", Kind: "records", Fields: make([]DocumentField, 0, len(projected.Fields)),
		Records:     make([]DocumentRecord, 0, len(projected.Records)),
		Cache:       DocumentCacheState{CachedAt: projected.CachedAt, StaleAt: projected.StaleAt, UsingCached: projected.UsingCached, Unavailable: projected.Unavailable},
		Attribution: projected.Attribution,
	}
	fieldTypes := map[string]string{}
	for _, field := range projected.Fields {
		if !validScalarKind(field.Type) || field.Key == "" || len(field.Key) > 80 {
			return nil, errors.New("projected field is invalid")
		}
		fieldTypes[field.Key] = field.Type
		dataset.Fields = append(dataset.Fields, DocumentField{Key: field.Key, Label: field.Label, Type: field.Type})
	}
	for _, record := range projected.Records {
		if record.ID == "" || len(record.ID) > 80 || len(record.Values) > 16 {
			return nil, errors.New("projected record is invalid")
		}
		values := make(map[string]DocumentValue, len(record.Values))
		for key, rawValue := range record.Values {
			if len(rawValue) > 4096 {
				return nil, errors.New("projected value is too long")
			}
			values[key] = coerceDocumentValue(fieldTypes[key], rawValue)
		}
		dataset.Records = append(dataset.Records, DocumentRecord{ID: record.ID, Values: values})
	}
	if projected.DateSelection != nil && projected.DateField != "" {
		dataset.Timezone = projected.DateSelection.Timezone
		dataset.DateSelection = &DocumentDateSelection{
			Field: projected.DateField, Timezone: projected.DateSelection.Timezone, Mode: projected.DateSelection.Mode,
			CustomStartDate: projected.DateSelection.CustomStartDate, CustomEndDate: projected.DateSelection.CustomEndDate,
			ExcludePast: projected.DateSelection.ExcludePast, NoMatchBehavior: projected.DateSelection.NoMatchBehavior,
			FallbackText: projected.DateSelection.FallbackText,
		}
	}
	return &DataDocument{SchemaVersion: DataDocumentSchemaVersion, Datasets: []DocumentDataset{dataset}}, nil
}

func validScalarKind(kind string) bool {
	switch kind {
	case "text", "number", "integer", "percent", "currency", "boolean", "date", "datetime", "duration", "url", "asset", "null":
		return true
	default:
		return false
	}
}

func coerceDocumentValue(kind, raw string) DocumentValue {
	if raw == "" {
		return DocumentValue{Kind: "null"}
	}
	switch kind {
	case "number", "percent", "currency":
		if value, err := strconv.ParseFloat(raw, 64); err == nil {
			return DocumentValue{Kind: kind, Number: &value}
		}
	case "integer":
		if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return DocumentValue{Kind: kind, Integer: &value}
		}
	case "boolean":
		if value, err := strconv.ParseBool(raw); err == nil {
			return DocumentValue{Kind: kind, Boolean: &value}
		}
	case "date":
		if _, err := time.Parse("2006-01-02", raw); err == nil {
			return DocumentValue{Kind: kind, Date: &raw}
		}
	case "datetime":
		if _, err := time.Parse(time.RFC3339, raw); err == nil {
			return DocumentValue{Kind: kind, DateTime: &raw}
		}
	case "url":
		if parsed, err := url.Parse(raw); err == nil && parsed.Scheme != "" && parsed.Host != "" {
			return DocumentValue{Kind: kind, URL: &raw}
		}
	}
	return DocumentValue{Kind: "text", Text: &raw}
}

func compileWidgetPresentation(provider string, raw json.RawMessage) (*WidgetPresentation, error) {
	switch provider {
	case "website", "youtube", "clock", "date", "qrcode", "countdown", "ticker", "menu", "list", "table", "agenda", "metric", "cards", "weather":
	default:
		return nil, errors.New("widget provider is not supported")
	}
	var c map[string]any
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	if provider == "website" || provider == "youtube" {
		return compileWebPresentation(provider, c)
	}
	root, capabilities, err := compileNativeRoot(provider, c)
	if err != nil {
		return nil, err
	}
	return &WidgetPresentation{
		SchemaVersion: PresentationSchemaVersion, Kind: "native", RequiredCapabilities: capabilities,
		Native: &NativePresentation{Root: root},
	}, nil
}

func (s *Service) CompileWidgetPresentation(provider string, raw json.RawMessage) (*WidgetPresentation, error) {
	return compileWidgetPresentation(provider, raw)
}

func compileWebPresentation(provider string, c map[string]any) (*WidgetPresentation, error) {
	rawURL, _ := c["url"].(string)
	if provider == "youtube" {
		videoID := stringValue(c, "videoId", "")
		playlistID := stringValue(c, "playlistId", "")
		if videoID != "" {
			rawURL = "https://www.youtube.com/embed/" + videoID + "?autoplay=1&playsinline=1"
		} else if playlistID != "" {
			rawURL = "https://www.youtube.com/embed/videoseries?autoplay=1&list=" + url.QueryEscape(playlistID)
		}
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return nil, errors.New("web presentation URL is invalid")
	}
	hosts := stringSlice(c["allowedHosts"])
	if len(hosts) == 0 {
		hosts = []string{strings.ToLower(parsed.Hostname())}
	}
	if provider == "youtube" {
		hosts = []string{"www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com", "i.ytimg.com", "googlevideo.com"}
	}
	timeout := intValue(c["loadTimeoutSeconds"], 20)
	lifecycle, _ := c["lifecycle"].(string)
	if lifecycle != "keep_warm" {
		lifecycle = "destroy_on_hide"
	}
	return &WidgetPresentation{
		SchemaVersion: PresentationSchemaVersion, Kind: "web",
		RequiredCapabilities: map[string]int{"web.remote": 1},
		Web: &WebSandboxPresentation{
			Mode: "remote", URL: rawURL, AllowedHosts: hosts, ExternalNetworkAccess: true, OnlineOnly: true,
			FallbackBehavior: stringValue(c, "failureBehavior", "placeholder"), LoadTimeoutSeconds: timeout,
			Lifecycle: lifecycle, WarmSeconds: min(intValue(c["warmSeconds"], 0), 300),
		},
	}, nil
}

func compileNativeRoot(provider string, c map[string]any) (PresentationNode, map[string]int, error) {
	background := stringValue(c, "backgroundColor", "#0E141B")
	foreground := stringValue(c, "foregroundColor", "#F5F7FA")
	surface := PresentationNode{Type: "surface", Props: map[string]any{"backgroundColor": background, "padding": intValue(c["contentPadding"], 10)}}
	caps := map[string]int{"layout.surface": 1, "content.text": 1, "binding.core": 1, "format.typed": 1}
	text := func(binding PresentationBinding, role string) PresentationNode {
		return PresentationNode{Type: "text", Props: map[string]any{"color": foreground, "role": role}, Binding: &binding}
	}
	switch provider {
	case "clock":
		surface.Children = []PresentationNode{text(PresentationBinding{Source: "environment", Path: "currentTime", Format: "time:" + stringValue(c, "format", "12") + ":" + strconv.FormatBool(boolValue(c["showSeconds"])) + ":" + stringValue(c, "timezone", "UTC")}, "metric")}
		caps["environment.time"] = 1
	case "date":
		surface.Children = []PresentationNode{text(PresentationBinding{Source: "environment", Path: "currentTime", Format: "date:" + stringValue(c, "format", "full") + ":" + stringValue(c, "timezone", "UTC")}, "metric")}
		caps["environment.time"] = 1
	case "countdown":
		surface.Children = []PresentationNode{
			text(PresentationBinding{Source: "literal", Value: stringValue(c, "label", "")}, "label"),
			text(PresentationBinding{Source: "environment", Path: "currentTime", Format: "countdown:" + stringValue(c, "target", "") + ":" + stringValue(c, "timezone", "UTC") + ":" + stringValue(c, "mode", "countdown") + ":" + stringValue(c, "completionText", "Complete")}, "metric"),
		}
		caps["environment.time"] = 1
	case "qrcode":
		surface.Children = []PresentationNode{{Type: "qr_code", Props: map[string]any{"errorCorrection": stringValue(c, "errorCorrection", "medium")}, Binding: &PresentationBinding{Source: "literal", Value: stringValue(c, "value", "")}}, text(PresentationBinding{Source: "literal", Value: stringValue(c, "label", "")}, "label")}
		caps["content.qr_code"] = 1
	case "ticker":
		fields := stringSlice(c["fields"])
		if len(fields) == 0 {
			fields = []string{stringValue(c, "field", "title")}
		}
		surface.Children = []PresentationNode{{Type: "marquee", Props: map[string]any{"color": foreground, "speed": stringValue(c, "speed", "normal"), "direction": stringValue(c, "direction", "left")}, Binding: &PresentationBinding{Source: "dataset", Dataset: stringValue(c, "dataSourceId", "") + ":records", Fields: fields, Separator: stringValue(c, "separator", " • "), Fallback: stringValue(c, "emptyState", "")}}}
		caps["content.marquee"] = 1
	default:
		dataSourceID := stringValue(c, "dataSourceId", "")
		limit := intValue(c["maximumItems"], 20)
		fields := presentationFields(provider, c)
		if dataSourceID == "" || len(fields) == 0 {
			return PresentationNode{}, nil, errors.New("data-driven presentation is incomplete")
		}
		columns := make([]PresentationNode, 0, len(fields))
		for index, field := range fields {
			role := "body"
			if index == 0 {
				role = "title"
			}
			columns = append(columns, text(PresentationBinding{Source: "repeat", Path: field, Format: fieldFormat(c, field), Fallback: ""}, role))
		}
		itemType := "row"
		if provider == "cards" {
			itemType = "column"
		}
		repeat := PresentationNode{Type: "repeat", Repeat: &PresentationRepeat{Dataset: dataSourceID + ":records", Limit: limit}, Children: []PresentationNode{{Type: itemType, Children: columns}}}
		if provider == "cards" {
			surface.Children = []PresentationNode{{Type: "grid", Props: map[string]any{"columns": intValue(c["columns"], 1)}, Children: []PresentationNode{repeat}}}
			caps["layout.grid"] = 1
		} else {
			surface.Children = []PresentationNode{{Type: "column", Children: []PresentationNode{repeat}}}
			caps["layout.column"] = 1
			caps["layout.row"] = 1
		}
		caps["collection.repeat"] = 1
	}
	return surface, caps, nil
}

func presentationFields(provider string, c map[string]any) []string {
	switch provider {
	case "metric":
		return nonEmptyStrings(stringValue(c, "labelField", ""), stringValue(c, "valueField", ""), stringValue(c, "secondaryField", ""))
	case "cards":
		return nonEmptyStrings(stringValue(c, "badgeField", ""), stringValue(c, "titleField", ""), stringValue(c, "subtitleField", ""), stringValue(c, "bodyField", ""))
	case "weather":
		return []string{"date", "location", "temperature", "condition", "humidity", "windSpeed", "precipitation", "high", "low", "attribution"}
	case "agenda":
		return nonEmptyStrings(stringValue(c, "dateField", "date"), stringValue(c, "timeField", "startTime"), stringValue(c, "titleField", "title"), stringValue(c, "locationField", "location"), stringValue(c, "descriptionField", "description"))
	default:
		fields := stringSlice(c["fields"])
		if len(fields) == 0 {
			fields = nonEmptyStrings(stringValue(c, "leadingField", ""), stringValue(c, "primaryField", "title"), stringValue(c, "secondaryField", ""), stringValue(c, "trailingField", ""))
		}
		return fields
	}
}

func fieldFormat(c map[string]any, field string) string {
	if stringValue(c, "valueField", "") == field {
		return stringValue(c, "format", "")
	}
	return ""
}

func stringValue(values map[string]any, key, fallback string) string {
	if value, ok := values[key].(string); ok {
		return value
	}
	return fallback
}

func stringSlice(value any) []string {
	items, _ := value.([]any)
	result := make([]string, 0, len(items))
	for _, item := range items {
		if value, ok := item.(string); ok && value != "" {
			result = append(result, value)
		}
	}
	return result
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
}

func intValue(value any, fallback int) int {
	if number, ok := value.(float64); ok {
		return int(number)
	}
	return fallback
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
