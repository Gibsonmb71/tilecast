package media

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

// defaultFormAttachmentMaxBytes bounds a form attachment when no media upload limit is configured.
const defaultFormAttachmentMaxBytes = 25 << 20

// IngestFormAttachment creates a dedicated form-attachment asset from uploaded bytes. Unlike the
// generic upload path it stamps origin='form_attachment' at creation, so the asset can never be
// selected as public Media and never enters a manifest until an approving projection references it.
// The bytes must be an image; other types are rejected. Submitters can call this without general
// Media-management permission (the forms layer authorizes them against the target record).
func (s *Service) IngestFormAttachment(ctx context.Context, userID uuid.UUID, filename, declaredMIME string, data []byte) (Asset, error) {
	if s.storage == nil {
		return Asset{}, errors.New("media storage is not configured")
	}
	if len(data) == 0 {
		return Asset{}, errors.New("attachment is empty")
	}
	maxBytes := s.cfg.MaxUploadBytes
	if maxBytes <= 0 {
		maxBytes = defaultFormAttachmentMaxBytes
	}
	if int64(len(data)) > maxBytes {
		return Asset{}, ErrUploadTooLarge
	}
	header := data
	if len(header) > 512 {
		header = data[:512]
	}
	detected, err := DetectType(header)
	if err != nil {
		return Asset{}, err
	}
	if detected.AssetType != "image" {
		return Asset{}, errors.New("form attachments must be images")
	}
	var organizationID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton=TRUE`).Scan(&organizationID); err != nil {
		return Asset{}, err
	}
	assetID, variantID := uuid.New(), uuid.New()
	finalKey := OriginalKey(assetID, detected.Extension)
	if err := s.storage.WriteAtomic(finalKey, func(w io.Writer) error { _, writeErr := w.Write(data); return writeErr }); err != nil {
		return Asset{}, err
	}
	sum := sha256.Sum256(data)
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	if strings.TrimSpace(name) == "" {
		name = "Attachment"
	}
	if len(name) > 180 {
		name = name[:180]
	}
	now := time.Now().UTC()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		_ = s.storage.Delete(finalKey)
		return Asset{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	cleanup := func(cause error) (Asset, error) {
		_ = s.storage.Delete(finalKey)
		return Asset{}, cause
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assets (id,organization_id,name,type,original_filename,declared_mime_type,detected_mime_type,sha256,original_size,processing_status,origin,created_by,created_at,updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued','form_attachment',$10,$11,$11)`,
		assetID, organizationID, name, detected.AssetType, filename, declaredMIME, detected.MIMEType, sum[:], int64(len(data)), userID, now); err != nil {
		return cleanup(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO asset_variants (id,asset_id,kind,storage_provider,storage_key,mime_type,file_size,sha256)
		VALUES ($1,$2,'original','local',$3,$4,$5,$6)`, variantID, assetID, finalKey, detected.MIMEType, int64(len(data)), sum[:]); err != nil {
		return cleanup(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO media_jobs (id,asset_id,kind,status) VALUES ($1,$2,'inspect_asset','queued')`, uuid.New(), assetID); err != nil {
		return cleanup(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs (id,user_id,action,resource_type,resource_id,metadata)
		VALUES ($1,$2,'form.attachment_uploaded','asset',$3,jsonb_build_object('filename',$4::text))`, uuid.New(), userID, assetID.String(), filename); err != nil {
		return cleanup(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return cleanup(err)
	}
	return s.GetAsset(ctx, assetID)
}

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
