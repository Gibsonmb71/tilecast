package media

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
)

var definitionColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$`)

type definitionConfigNormalizer struct {
	service *Service
	schema  contentdefs.ConfigurationSchema
}

func (normalizer definitionConfigNormalizer) Normalize(ctx context.Context, raw json.RawMessage) (any, error) {
	var input map[string]any
	if err := decodeConfig(raw, &input); err != nil {
		return nil, err
	}
	return normalizer.normalizeObject(ctx, input, normalizer.schema.Fields, "")
}

func (normalizer definitionConfigNormalizer) normalizeObject(ctx context.Context, input map[string]any, fields []contentdefs.FieldDefinition, prefix string) (map[string]any, error) {
	known := make(map[string]contentdefs.FieldDefinition, len(fields))
	for _, field := range fields {
		known[field.Key] = field
	}
	for key := range input {
		if _, ok := known[key]; !ok {
			return nil, fmt.Errorf("configuration contains unknown field %q", prefix+key)
		}
	}
	output := make(map[string]any, len(fields))
	for _, field := range fields {
		value, present := input[field.Key]
		if !present && field.Default != nil {
			value, present = field.Default, true
		}
		if !present || value == nil || (field.Required && value == "") {
			if field.Required {
				return nil, fmt.Errorf("%s is required", field.Label)
			}
			continue
		}
		normalized, err := normalizer.normalizeField(ctx, field, value, prefix+field.Key)
		if err != nil {
			return nil, err
		}
		output[field.Key] = normalized
	}
	if prefix == "" {
		if err := normalizer.validateDataSourceFieldSelections(ctx, fields, output); err != nil {
			return nil, err
		}
	}
	return output, nil
}

func (normalizer definitionConfigNormalizer) validateDataSourceFieldSelections(ctx context.Context, fields []contentdefs.FieldDefinition, values map[string]any) error {
	rawID, _ := values["dataSourceId"].(string)
	if rawID == "" {
		return nil
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		return errors.New("Data Source is invalid")
	}
	var provider string
	if err = normalizer.service.db.QueryRow(ctx, `SELECT provider FROM data_sources WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&provider); err != nil {
		return errors.New("Data Source is unavailable")
	}
	definition, ok := normalizer.service.definitions.DataSource(provider)
	if !ok {
		return errors.New("Data Source provider is unknown")
	}
	types := map[string]string{}
	for _, output := range definition.OutputSchema.Fields {
		types[output.Key] = output.Type
	}
	for _, field := range fields {
		if field.Control != "data_source_field" {
			continue
		}
		selected, _ := values[field.Key].(string)
		selectedType, exists := types[selected]
		if !exists {
			return fmt.Errorf("%s references a field the Data Source does not expose", field.Label)
		}
		if len(field.DataSourceFieldTypes) > 0 && !containsString(field.DataSourceFieldTypes, selectedType) {
			return fmt.Errorf("%s requires a field of type %s", field.Label, strings.Join(field.DataSourceFieldTypes, " or "))
		}
	}
	return nil
}

func (normalizer definitionConfigNormalizer) normalizeField(ctx context.Context, field contentdefs.FieldDefinition, value any, path string) (any, error) {
	switch field.Control {
	case "text", "multiline_text", "color", "date", "datetime", "timezone", "url", "data_source", "data_source_field", "media_asset":
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be text", field.Label)
		}
		text = strings.TrimSpace(text)
		if field.MinLength > 0 && len(text) < field.MinLength || field.MaxLength > 0 && len(text) > field.MaxLength {
			return nil, fmt.Errorf("%s length is outside the allowed range", field.Label)
		}
		switch field.Control {
		case "color":
			if !definitionColorPattern.MatchString(text) {
				return nil, fmt.Errorf("%s must be a hexadecimal color", field.Label)
			}
			text = strings.ToLower(text)
		case "date":
			if text != "" {
				if _, err := time.Parse("2006-01-02", text); err != nil {
					return nil, fmt.Errorf("%s must be a date", field.Label)
				}
			}
		case "datetime":
			if text != "" {
				parsed, err := time.Parse(time.RFC3339, text)
				if err != nil {
					return nil, fmt.Errorf("%s must be an RFC 3339 datetime", field.Label)
				}
				text = parsed.UTC().Format(time.RFC3339)
			}
		case "timezone":
			if _, err := time.LoadLocation(text); err != nil {
				return nil, fmt.Errorf("%s must be an IANA timezone", field.Label)
			}
		case "url":
			parsed, err := url.Parse(text)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
				return nil, fmt.Errorf("%s must be an HTTP or HTTPS URL", field.Label)
			}
		case "data_source":
			id, err := uuid.Parse(text)
			if err != nil {
				return nil, fmt.Errorf("%s must identify a Data Source", field.Label)
			}
			if err := normalizer.validateDataSource(ctx, id, field); err != nil {
				return nil, err
			}
			text = id.String()
		case "media_asset":
			id, err := uuid.Parse(text)
			if err != nil {
				return nil, fmt.Errorf("%s must identify a media asset", field.Label)
			}
			var assetType string
			if err := normalizer.service.db.QueryRow(ctx, `SELECT type FROM assets WHERE id=$1 AND deleted_at IS NULL AND processing_status='ready'`, id).Scan(&assetType); err != nil {
				return nil, fmt.Errorf("%s references an unavailable media asset", field.Label)
			}
			if len(field.MediaTypes) > 0 && !containsString(field.MediaTypes, assetType) {
				return nil, fmt.Errorf("%s references an incompatible media asset", field.Label)
			}
			text = id.String()
		}
		return text, nil
	case "number", "integer":
		number, ok := value.(float64)
		if !ok || field.Control == "integer" && math.Trunc(number) != number {
			return nil, fmt.Errorf("%s must be a %s", field.Label, field.Control)
		}
		if field.Minimum != nil && number < *field.Minimum || field.Maximum != nil && number > *field.Maximum {
			return nil, fmt.Errorf("%s is outside the allowed range", field.Label)
		}
		if field.Control == "integer" {
			return int(number), nil
		}
		return number, nil
	case "boolean":
		boolean, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("%s must be true or false", field.Label)
		}
		return boolean, nil
	case "select":
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be selected", field.Label)
		}
		for _, option := range field.Options {
			if option.Value == text {
				return text, nil
			}
		}
		return nil, fmt.Errorf("%s has an invalid selection", field.Label)
	case "repeating_group":
		items, ok := value.([]any)
		if !ok || len(items) > field.MaximumItems {
			return nil, fmt.Errorf("%s exceeds its bounded item limit", field.Label)
		}
		normalized := make([]map[string]any, 0, len(items))
		for index, item := range items {
			object, ok := item.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%s item %d is invalid", field.Label, index+1)
			}
			result, err := normalizer.normalizeObject(ctx, object, field.ItemFields, fmt.Sprintf("%s[%d].", path, index))
			if err != nil {
				return nil, err
			}
			normalized = append(normalized, result)
		}
		return normalized, nil
	default:
		return nil, errors.New("unsupported release-defined form control")
	}
}

func (normalizer definitionConfigNormalizer) validateDataSource(ctx context.Context, id uuid.UUID, field contentdefs.FieldDefinition) error {
	var provider string
	if err := normalizer.service.db.QueryRow(ctx, `SELECT provider FROM data_sources WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&provider); err != nil {
		return fmt.Errorf("%s references an unavailable Data Source", field.Label)
	}
	definition, ok := normalizer.service.definitions.DataSource(provider)
	if !ok {
		return fmt.Errorf("%s references an unknown Data Source provider", field.Label)
	}
	if len(field.AcceptedDataSourceKinds) > 0 && !containsString(field.AcceptedDataSourceKinds, definition.OutputSchema.Kind) {
		return fmt.Errorf("%s requires a %s Data Source", field.Label, strings.Join(field.AcceptedDataSourceKinds, " or "))
	}
	available := map[string]string{}
	for _, output := range definition.OutputSchema.Fields {
		available[output.Key] = output.Type
	}
	for key, requiredType := range field.RequiredFields {
		if available[key] != requiredType {
			return fmt.Errorf("%s requires Data Source field %s of type %s", field.Label, key, requiredType)
		}
	}
	return nil
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

type schoolStatusSourceConfig struct {
	Status      string `json:"status"`
	Message     string `json:"message"`
	Severity    string `json:"severity"`
	EffectiveAt string `json:"effectiveAt,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

func schoolStatusPayload(configuration schoolStatusSourceConfig, updatedAt time.Time) TypedDatasetPayload {
	fields := []DataSourceField{
		{Key: "status", Label: "Status", Type: "text"},
		{Key: "message", Label: "Message", Type: "text"},
		{Key: "severity", Label: "Severity", Type: "text"},
		{Key: "effectiveAt", Label: "Effective time", Type: "datetime"},
		{Key: "expiresAt", Label: "Expiration time", Type: "datetime"},
		{Key: "updatedAt", Label: "Updated time", Type: "datetime"},
	}
	return TypedDatasetPayload{Datasets: []TypedDataset{{
		ID: "object", Kind: "object", Fields: fields,
		Values: map[string]string{
			"status": configuration.Status, "message": configuration.Message,
			"severity": configuration.Severity, "effectiveAt": configuration.EffectiveAt,
			"expiresAt": configuration.ExpiresAt, "updatedAt": updatedAt.UTC().Format(time.RFC3339),
		},
		CachedAt: &updatedAt, StaleAt: &updatedAt,
	}}}
}
