package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// Form Data Sources are owned by the forms package, which writes the data_sources row and the
// cached typed-dataset payload directly. This file carries only the pieces the media package
// needs so it stays free of any dependency on forms: the shared configuration shape (so widget
// field discovery and the Player projection are pure functions of the stored configuration),
// and a defensive normalizer registered under the "form_records" adapter id.

// formOutputFieldTypes bounds the typed values a form field may expose to Widgets. It mirrors
// the catalog's supportedOutputFieldTypes for the kinds a form builder can produce.
var formOutputFieldTypes = map[string]bool{
	"text": true, "number": true, "integer": true, "boolean": true,
	"date": true, "datetime": true, "url": true, "asset": true,
}

// FormFieldSpec is one selectable output field a Form Data Source exposes to Widgets. The
// forms service derives these from the published revision (plus synthetic record fields) and
// stores them on data_sources.configuration so field discovery needs no extra query.
type FormFieldSpec struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

// FormViewSpec names one saved output view. Each maps to one typed dataset in the cached
// payload, keyed by Key, so Widgets can select a named dataset under the Form Data Source.
type FormViewSpec struct {
	Key    string   `json:"key"`
	Name   string   `json:"name"`
	Fields []string `json:"fields,omitempty"`
}

// FormSourceConfig is the minimal object stored on data_sources.configuration for a Form Data
// Source. Records, workflow, views, grants, history, and attachments live in dedicated tables.
type FormSourceConfig struct {
	CurrentRevisionID    string            `json:"currentRevisionId,omitempty"`
	Fields               []FormFieldSpec   `json:"fields"`
	Views                []FormViewSpec    `json:"views"`
	DisplayFieldMappings map[string]string `json:"displayFieldMappings,omitempty"`
	// DraftSchema is the editable, not-yet-published form definition. It is opaque to the media
	// package (the forms package owns its shape and validation) and is preserved across updates.
	DraftSchema json.RawMessage `json:"draftSchema,omitempty"`
}

type formSourceProvider struct{ service *Service }

// Normalize validates the stored configuration shape. Form mutation flows through the forms
// package and the /forms endpoints, not the generic Data Source update path, so this normalizer
// only guards structural integrity when a form configuration passes through generic handling.
func (formSourceProvider) Normalize(_ context.Context, raw json.RawMessage) (any, error) {
	var config FormSourceConfig
	if len(raw) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&config); err != nil {
			return nil, fmt.Errorf("form configuration is invalid: %w", err)
		}
	}
	if config.CurrentRevisionID != "" {
		if _, err := uuid.Parse(config.CurrentRevisionID); err != nil {
			return nil, errors.New("form configuration has an invalid current revision id")
		}
	}
	seenFields := map[string]bool{}
	for _, field := range config.Fields {
		if field.Key == "" || seenFields[field.Key] {
			return nil, errors.New("form configuration has a missing or duplicate field key")
		}
		seenFields[field.Key] = true
		if !formOutputFieldTypes[field.Type] {
			return nil, fmt.Errorf("form field %q uses unsupported type %q", field.Key, field.Type)
		}
	}
	seenViews := map[string]bool{}
	for _, view := range config.Views {
		if view.Key == "" || seenViews[view.Key] {
			return nil, errors.New("form configuration has a missing or duplicate view key")
		}
		seenViews[view.Key] = true
		for _, key := range view.Fields {
			if !seenFields[key] {
				return nil, fmt.Errorf("form view %q references unknown field %q", view.Key, key)
			}
		}
	}
	for role, key := range config.DisplayFieldMappings {
		if key != "" && !seenFields[key] {
			return nil, fmt.Errorf("form display mapping %q references unknown field %q", role, key)
		}
	}
	if config.Fields == nil {
		config.Fields = []FormFieldSpec{}
	}
	if config.Views == nil {
		config.Views = []FormViewSpec{}
	}
	return config, nil
}
