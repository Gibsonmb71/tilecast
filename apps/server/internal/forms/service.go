package forms

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/contentdefs"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

// Service owns Form Data Source domain logic. It depends on the media service (parent
// data_sources row shape, attachment ingestion, typed-dataset types) and on the shared
// AssetInvalidator so that projecting approved records bumps affected manifests, but the media
// package never depends on this one.
type Service struct {
	db          *pgxpool.Pool
	media       *media.Service
	invalidator media.AssetInvalidator
	definitions *contentdefs.Catalog
}

func NewService(db *pgxpool.Pool, mediaService *media.Service) *Service {
	return &Service{db: db, media: mediaService, definitions: contentdefs.MustLoad()}
}

func (s *Service) SetAssetInvalidator(invalidator media.AssetInvalidator) {
	s.invalidator = invalidator
}
func (s *Service) SetContentDefinitions(catalog *contentdefs.Catalog) { s.definitions = catalog }

// providerName is the reserved Data Source provider id for forms.
const providerName = "form"

// ensureForm confirms the id references a live Form Data Source and returns its creator.
func (s *Service) ensureForm(ctx context.Context, q rowQuerier, id uuid.UUID) (*uuid.UUID, error) {
	var provider string
	var createdBy *uuid.UUID
	err := q.QueryRow(ctx, `SELECT provider,created_by FROM data_sources WHERE id=$1 AND deleted_at IS NULL`, id).Scan(&provider, &createdBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if provider != providerName {
		return nil, ErrNotFound
	}
	return createdBy, nil
}

type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *Service) userGlobalRole(ctx context.Context, q rowQuerier, userID uuid.UUID) (string, error) {
	var role string
	err := q.QueryRow(ctx, `SELECT role FROM users WHERE id=$1`, userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return role, err
}

func (s *Service) userName(ctx context.Context, q rowQuerier, userID uuid.UUID) string {
	var name string
	_ = q.QueryRow(ctx, `SELECT name FROM users WHERE id=$1`, userID).Scan(&name)
	return name
}

// Authorize reports whether userID may perform an action needing capability on form id. The
// form creator and any global Owner always have full manage access; everyone else needs an
// explicit grant that satisfies the requested capability.
func (s *Service) Authorize(ctx context.Context, id, userID uuid.UUID, need Capability) (bool, error) {
	createdBy, err := s.ensureForm(ctx, s.db, id)
	if err != nil {
		return false, err
	}
	if createdBy != nil && *createdBy == userID {
		return true, nil
	}
	role, err := s.userGlobalRole(ctx, s.db, userID)
	if err != nil {
		return false, err
	}
	if role == "owner" {
		return true, nil
	}
	rows, err := s.db.Query(ctx, `SELECT capability FROM form_grants WHERE data_source_id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var held string
		if err := rows.Scan(&held); err != nil {
			return false, err
		}
		if capabilitySatisfies(Capability(held), need) {
			return true, nil
		}
	}
	return false, rows.Err()
}

// grantedCapabilities returns every capability userID effectively holds on form id, expanding
// creator/owner into the full set. Used to decorate the Form detail for the UI.
func (s *Service) grantedCapabilities(ctx context.Context, q rowQuerier, id uuid.UUID, createdBy *uuid.UUID, userID uuid.UUID) ([]Capability, error) {
	if createdBy != nil && *createdBy == userID {
		return []Capability{CapManage}, nil
	}
	if role, err := s.userGlobalRole(ctx, q, userID); err == nil && role == "owner" {
		return []Capability{CapManage}, nil
	}
	rows, err := q.Query(ctx, `SELECT capability FROM form_grants WHERE data_source_id=$1 AND user_id=$2 ORDER BY capability`, id, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Capability{}
	for rows.Next() {
		var held string
		if err := rows.Scan(&held); err != nil {
			return nil, err
		}
		result = append(result, Capability(held))
	}
	return result, rows.Err()
}

// syncConfiguration rewrites data_sources.configuration for a form so media's field discovery
// (availableDataSourceFields) and the provider gallery stay in agreement with the published
// revision and saved views. It must run inside the same transaction as any schema/view change.
// When draft is non-nil it replaces the stored editable draft; otherwise the existing draft is
// preserved.
func (s *Service) syncConfiguration(ctx context.Context, tx pgx.Tx, id uuid.UUID, draft *FormSchema) error {
	var existingRaw []byte
	if err := tx.QueryRow(ctx, `SELECT configuration FROM data_sources WHERE id=$1`, id).Scan(&existingRaw); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var currentRevisionID *uuid.UUID
	var schemaRaw []byte
	err := tx.QueryRow(ctx, `SELECT r.id, r.schema FROM form_revisions r
		WHERE r.data_source_id=$1 ORDER BY r.revision_number DESC LIMIT 1`, id).Scan(&currentRevisionID, &schemaRaw)
	config := media.FormSourceConfig{Fields: []media.FormFieldSpec{}, Views: []media.FormViewSpec{}}
	// Carry forward the existing editable draft unless the caller supplies a new one.
	if len(existingRaw) > 0 {
		var previous media.FormSourceConfig
		if json.Unmarshal(existingRaw, &previous) == nil {
			config.DraftSchema = previous.DraftSchema
			config.DisplayFieldMappings = previous.DisplayFieldMappings
		}
	}
	if draft != nil {
		encodedDraft, marshalErr := json.Marshal(draft)
		if marshalErr != nil {
			return marshalErr
		}
		config.DraftSchema = encodedDraft
	}
	if err == nil {
		config.CurrentRevisionID = currentRevisionID.String()
		var schema FormSchema
		if len(schemaRaw) > 0 {
			_ = json.Unmarshal(schemaRaw, &schema)
		}
		config.Fields = outputFieldSpecs(schema)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	viewRows, err := tx.Query(ctx, `SELECT key,name,output_fields FROM form_views WHERE data_source_id=$1 AND deleted_at IS NULL ORDER BY position,key`, id)
	if err != nil {
		return err
	}
	defer viewRows.Close()
	for viewRows.Next() {
		var spec media.FormViewSpec
		if err := viewRows.Scan(&spec.Key, &spec.Name, &spec.Fields); err != nil {
			return err
		}
		config.Views = append(config.Views, spec)
	}
	if err := viewRows.Err(); err != nil {
		return err
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE data_sources SET configuration=$2::jsonb,updated_at=now() WHERE id=$1`, id, string(encoded))
	return err
}

// outputFieldSpecs derives the selectable Widget fields for a published schema: one per
// output-producing form field, plus the synthetic record fields every form exposes.
func outputFieldSpecs(schema FormSchema) []media.FormFieldSpec {
	fields := []media.FormFieldSpec{}
	for _, field := range schema.Fields {
		typ := outputTypeFor(field.Control)
		if typ == "" {
			continue
		}
		fields = append(fields, media.FormFieldSpec{Key: field.Key, Label: field.Label, Type: typ})
	}
	fields = append(fields,
		media.FormFieldSpec{Key: "state", Label: "Workflow state", Type: "text"},
		media.FormFieldSpec{Key: "displayTitle", Label: "Display title", Type: "text"},
		media.FormFieldSpec{Key: "priority", Label: "Priority", Type: "integer"},
		media.FormFieldSpec{Key: "submittedAt", Label: "Submitted time", Type: "datetime"},
		media.FormFieldSpec{Key: "displayAt", Label: "Display from", Type: "datetime"},
		media.FormFieldSpec{Key: "expiresAt", Label: "Expires at", Type: "datetime"},
	)
	return fields
}

// reservedFieldKeys are the synthetic keys a form always exposes; a user field may not shadow
// them.
var reservedFieldKeys = map[string]bool{
	"state": true, "displayTitle": true, "priority": true, "submittedAt": true,
	"displayAt": true, "expiresAt": true, "id": true,
}
