package forms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

// RecordInput carries submitted or edited record values and display metadata. The display fields
// are tri-state (see Optional): omitted preserves the stored value, explicit null clears it, and
// a value replaces it.
type RecordInput struct {
	Values       map[string]any
	DisplayTitle Optional[string]
	Priority     Optional[int]
	DisplayAt    Optional[time.Time]
	ExpiresAt    Optional[time.Time]
}

// RecordFilter selects and paginates records.
type RecordFilter struct {
	States      []string
	Search      string
	SubmittedBy *uuid.UUID
	Sort        string
	Page        int
	PageSize    int
}

// RecordPage is a paginated slice of records.
type RecordPage struct {
	Items    []Record `json:"items"`
	Total    int      `json:"total"`
	Page     int      `json:"page"`
	PageSize int      `json:"pageSize"`
}

// recordMeta is the minimal record identity used for authorization decisions.
type recordMeta struct {
	id           uuid.UUID
	dataSourceID uuid.UUID
	revisionID   uuid.UUID
	state        string
	owner        *uuid.UUID
	version      int
	eligible     bool
}

// loadRecordScoped returns a record's identity scoped to a form. A record that does not exist, is
// deleted, or belongs to a different Form Data Source returns ErrNotFound so callers never leak
// the existence of records outside the addressed form.
func (s *Service) loadRecordScoped(ctx context.Context, q rowQuerier, formID, recordID uuid.UUID) (recordMeta, error) {
	var meta recordMeta
	err := q.QueryRow(ctx, `SELECT id,data_source_id,revision_id,state_key,submitted_by,version,eligible
		FROM form_records WHERE id=$1 AND deleted_at IS NULL`, recordID).
		Scan(&meta.id, &meta.dataSourceID, &meta.revisionID, &meta.state, &meta.owner, &meta.version, &meta.eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		return recordMeta{}, ErrNotFound
	}
	if err != nil {
		return recordMeta{}, err
	}
	if meta.dataSourceID != formID {
		return recordMeta{}, ErrNotFound
	}
	return meta, nil
}

// allow is a small helper that treats an authorization error as "not allowed" only when the form
// is missing; real errors propagate.
func (s *Service) allow(ctx context.Context, formID, userID uuid.UUID, need Capability) (bool, error) {
	return s.Authorize(ctx, formID, userID, need)
}

// visibilityError chooses 404 vs 403 so a submitter cannot probe for records they may not see: a
// user who owns the record or can view all records gets Forbidden; anyone else gets NotFound.
func visibilityError(isOwner, canViewAll bool) error {
	if isOwner || canViewAll {
		return ErrForbidden
	}
	return ErrNotFound
}

// stateSubmitterEditable reports whether a state allows submitter edits, defined as any state
// with an outgoing transition that requires the submit capability (draft and changes_requested by
// default). This keeps "editable states" derived from the configured workflow rather than hardcoded.
func (s *Service) stateSubmitterEditable(ctx context.Context, q rowQuerier, formID uuid.UUID, state string) (bool, error) {
	var editable bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM form_workflow_transitions
		WHERE data_source_id=$1 AND from_state=$2 AND required_capability='submit')`, formID, state).Scan(&editable)
	return editable, err
}

// authorizeEdit enforces who may edit a record's fields or attachments: a manager may edit any
// record; otherwise the caller must own the record, hold submit, and the record must be in a
// submitter-editable state. Existence is hidden from callers who may not see the record.
func (s *Service) authorizeEdit(ctx context.Context, formID, recordID, userID uuid.UUID) (recordMeta, error) {
	meta, err := s.loadRecordScoped(ctx, s.db, formID, recordID)
	if err != nil {
		return recordMeta{}, err
	}
	manage, err := s.allow(ctx, formID, userID, CapManage)
	if err != nil {
		return recordMeta{}, err
	}
	if manage {
		return meta, nil
	}
	isOwner := meta.owner != nil && *meta.owner == userID
	canViewAll, err := s.allow(ctx, formID, userID, CapViewAll)
	if err != nil {
		return recordMeta{}, err
	}
	if !isOwner {
		return recordMeta{}, visibilityError(false, canViewAll)
	}
	hasSubmit, err := s.allow(ctx, formID, userID, CapSubmit)
	if err != nil {
		return recordMeta{}, err
	}
	if !hasSubmit {
		return recordMeta{}, ErrForbidden
	}
	editable, err := s.stateSubmitterEditable(ctx, s.db, formID, meta.state)
	if err != nil {
		return recordMeta{}, err
	}
	if !editable {
		return recordMeta{}, fmt.Errorf("%w: the record cannot be edited in its current state", ErrValidation)
	}
	return meta, nil
}

// CreateRecord creates a draft submission bound to the form's current published revision. The
// caller must hold the submit capability on the form.
func (s *Service) CreateRecord(ctx context.Context, formID, actor uuid.UUID, in RecordInput) (Record, error) {
	if _, err := s.ensureForm(ctx, s.db, formID); err != nil {
		return Record{}, err
	}
	allowed, err := s.allow(ctx, formID, actor, CapSubmit)
	if err != nil {
		return Record{}, err
	}
	if !allowed {
		return Record{}, ErrForbidden
	}
	revision, err := s.loadPublishedRevision(ctx, s.db, formID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return Record{}, fmt.Errorf("%w: the form has no published revision", ErrValidation)
		}
		return Record{}, err
	}
	values, err := validateRecordValues(revision.Schema, in.Values, false)
	if err != nil {
		return Record{}, err
	}
	initialState, err := initialStateKey(ctx, s.db, formID)
	if err != nil {
		return Record{}, err
	}
	encoded, _ := json.Marshal(values)
	recordID := uuid.New()
	displayTitle := ""
	if in.DisplayTitle.Set && in.DisplayTitle.Value != nil {
		displayTitle = strings.TrimSpace(*in.DisplayTitle.Value)
	}
	priority := 0
	if in.Priority.Set && in.Priority.Value != nil {
		priority = *in.Priority.Value
	}
	var displayAt, expiresAt *time.Time
	if in.DisplayAt.Set {
		displayAt = in.DisplayAt.Value
	}
	if in.ExpiresAt.Set {
		expiresAt = in.ExpiresAt.Value
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	submitterName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `INSERT INTO form_records(id,data_source_id,revision_id,state_key,values,submitted_by,submitter_name,display_title,priority,display_at,expires_at,eligible,version)
		VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,FALSE,1)`,
		recordID, formID, revision.ID, initialState, string(encoded), actor, submitterName, displayTitle, priority, displayAt, expiresAt); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "created", "", initialState, actor, submitterName, ""); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	return s.getRecordRow(ctx, s.db, recordID)
}

// UpdateRecord edits a record's values and display metadata under optimistic concurrency. Display
// fields are tri-state: omitted preserves, explicit null clears, a value replaces.
func (s *Service) UpdateRecord(ctx context.Context, formID, recordID, actor uuid.UUID, in RecordInput, expectedVersion int) (Record, error) {
	if _, err := s.authorizeEdit(ctx, formID, recordID, actor); err != nil {
		return Record{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var revisionID uuid.UUID
	var version int
	var eligible bool
	err = tx.QueryRow(ctx, `SELECT revision_id,version,eligible FROM form_records WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).Scan(&revisionID, &version, &eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	if version != expectedVersion {
		return Record{}, ErrConflict
	}
	schema, err := s.revisionSchema(ctx, tx, revisionID)
	if err != nil {
		return Record{}, err
	}
	values, err := validateRecordValues(schema, in.Values, eligible)
	if err != nil {
		return Record{}, err
	}
	encoded, _ := json.Marshal(values)
	sets := []string{"values=$2::jsonb", "version=version+1", "updated_at=now()"}
	args := []any{recordID, string(encoded)}
	addSet := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
	}
	if in.DisplayTitle.Set {
		if in.DisplayTitle.Value == nil {
			sets = append(sets, "display_title=''")
		} else {
			addSet("display_title", strings.TrimSpace(*in.DisplayTitle.Value))
		}
	}
	if in.Priority.Set {
		if in.Priority.Value == nil {
			sets = append(sets, "priority=0")
		} else {
			addSet("priority", *in.Priority.Value)
		}
	}
	if in.DisplayAt.clears() {
		sets = append(sets, "display_at=NULL")
	} else if in.DisplayAt.Set {
		addSet("display_at", *in.DisplayAt.Value)
	}
	if in.ExpiresAt.clears() {
		sets = append(sets, "expires_at=NULL")
	} else if in.ExpiresAt.Set {
		addSet("expires_at", *in.ExpiresAt.Value)
	}
	actorName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `UPDATE form_records SET `+strings.Join(sets, ",")+` WHERE id=$1`, args...); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "edited", "", "", actor, actorName, ""); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	if eligible {
		if err := s.RebuildProjection(ctx, formID); err != nil {
			return Record{}, err
		}
	}
	return s.getRecordRow(ctx, s.db, recordID)
}

// Transition moves a record to a new state, enforcing the configured workflow, per-form record
// ownership and capability rules, optimistic concurrency, and required-field completeness when
// entering an output-eligible state. It records history and rebuilds the projection so approvals
// reach signage and manifests are invalidated.
func (s *Service) Transition(ctx context.Context, formID, recordID, actor uuid.UUID, toState, note string, expectedVersion int) (Record, error) {
	meta, err := s.loadRecordScoped(ctx, s.db, formID, recordID)
	if err != nil {
		return Record{}, err
	}
	var requiredCapability string
	err = s.db.QueryRow(ctx, `SELECT required_capability FROM form_workflow_transitions
		WHERE data_source_id=$1 AND from_state=$2 AND to_state=$3`, formID, meta.state, toState).Scan(&requiredCapability)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, fmt.Errorf("%w: no transition from %q to %q", ErrValidation, meta.state, toState)
	}
	if err != nil {
		return Record{}, err
	}
	isOwner := meta.owner != nil && *meta.owner == actor
	manage, err := s.allow(ctx, formID, actor, CapManage)
	if err != nil {
		return Record{}, err
	}
	canViewAll, err := s.allow(ctx, formID, actor, CapViewAll)
	if err != nil {
		return Record{}, err
	}
	allowed := manage
	if !allowed {
		if Capability(requiredCapability) == CapSubmit {
			// Submitters may submit or resubmit only their own records.
			hasSubmit, err := s.allow(ctx, formID, actor, CapSubmit)
			if err != nil {
				return Record{}, err
			}
			allowed = isOwner && hasSubmit
		} else {
			// Review/approve transitions require that reviewer capability.
			allowed, err = s.allow(ctx, formID, actor, Capability(requiredCapability))
			if err != nil {
				return Record{}, err
			}
		}
	}
	if !allowed {
		return Record{}, visibilityError(isOwner, canViewAll)
	}
	var targetEligible bool
	if err := s.db.QueryRow(ctx, `SELECT eligible_for_output FROM form_workflow_states WHERE data_source_id=$1 AND state_key=$2`, formID, toState).Scan(&targetEligible); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Record{}, fmt.Errorf("%w: target state %q does not exist", ErrValidation, toState)
		}
		return Record{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var version int
	var lockedState string
	var revisionID uuid.UUID
	var valuesRaw []byte
	err = tx.QueryRow(ctx, `SELECT version,state_key,revision_id,values FROM form_records WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).
		Scan(&version, &lockedState, &revisionID, &valuesRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	if version != expectedVersion {
		return Record{}, ErrConflict
	}
	if lockedState != meta.state {
		return Record{}, ErrConflict
	}
	if targetEligible {
		schema, err := s.revisionSchema(ctx, tx, revisionID)
		if err != nil {
			return Record{}, err
		}
		var values map[string]any
		if len(valuesRaw) > 0 {
			_ = json.Unmarshal(valuesRaw, &values)
		}
		if _, err := validateRecordValues(schema, values, true); err != nil {
			return Record{}, err
		}
	}
	actorName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `UPDATE form_records SET state_key=$2,eligible=$3,version=version+1,updated_at=now() WHERE id=$1`, recordID, toState, targetEligible); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "transition", meta.state, toState, actor, actorName, note); err != nil {
		return Record{}, err
	}
	if strings.TrimSpace(note) != "" {
		if _, err := tx.Exec(ctx, `INSERT INTO form_record_comments(id,record_id,author_id,author_name,body) VALUES($1,$2,$3,$4,$5)`,
			uuid.New(), recordID, actor, actorName, strings.TrimSpace(note)); err != nil {
			return Record{}, err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)
		VALUES($1,$2,'form.record_transition','data_source',$3,jsonb_build_object('record',$4::text,'from',$5::text,'to',$6::text))`,
		uuid.New(), actor, formID.String(), recordID.String(), meta.state, toState); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	if err := s.RebuildProjection(ctx, formID); err != nil {
		return Record{}, err
	}
	return s.getRecordRow(ctx, s.db, recordID)
}

// DeleteRecord soft-deletes a record; only a manager may delete, and existence is hidden from
// callers who may not see the record.
func (s *Service) DeleteRecord(ctx context.Context, formID, recordID, actor uuid.UUID) error {
	meta, err := s.loadRecordScoped(ctx, s.db, formID, recordID)
	if err != nil {
		return err
	}
	manage, err := s.allow(ctx, formID, actor, CapManage)
	if err != nil {
		return err
	}
	if !manage {
		isOwner := meta.owner != nil && *meta.owner == actor
		canViewAll, err := s.allow(ctx, formID, actor, CapViewAll)
		if err != nil {
			return err
		}
		return visibilityError(isOwner, canViewAll)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var eligible bool
	if err := tx.QueryRow(ctx, `SELECT eligible FROM form_records WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).Scan(&eligible); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE form_records SET deleted_at=now(),eligible=FALSE,updated_at=now() WHERE id=$1`, recordID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)
		VALUES($1,$2,'form.record_deleted','data_source',$3)`, uuid.New(), actor, formID.String()); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if eligible {
		return s.RebuildProjection(ctx, formID)
	}
	return nil
}

// AddComment records a reviewer or submitter comment on a record. The comment and its history
// event commit together or not at all.
func (s *Service) AddComment(ctx context.Context, formID, recordID, actor uuid.UUID, body string) (RecordComment, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 4000 {
		return RecordComment{}, fmt.Errorf("%w: comment must be between 1 and 4000 characters", ErrValidation)
	}
	meta, err := s.loadRecordScoped(ctx, s.db, formID, recordID)
	if err != nil {
		return RecordComment{}, err
	}
	isOwner := meta.owner != nil && *meta.owner == actor
	canReview, err := s.allow(ctx, formID, actor, CapReview)
	if err != nil {
		return RecordComment{}, err
	}
	canViewAll, err := s.allow(ctx, formID, actor, CapViewAll)
	if err != nil {
		return RecordComment{}, err
	}
	if !canReview && !isOwner {
		return RecordComment{}, visibilityError(false, canViewAll)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return RecordComment{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	actorName := s.userName(ctx, tx, actor)
	commentID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO form_record_comments(id,record_id,author_id,author_name,body) VALUES($1,$2,$3,$4,$5)`,
		commentID, recordID, actor, actorName, body); err != nil {
		return RecordComment{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "comment", "", "", actor, actorName, body); err != nil {
		return RecordComment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RecordComment{}, err
	}
	return RecordComment{ID: commentID, AuthorName: actorName, Body: body, CreatedAt: time.Now().UTC()}, nil
}

// AttachmentUpload carries the bytes and metadata for a new form attachment.
type AttachmentUpload struct {
	FieldKey    string
	FileName    string
	ContentType string
	Data        []byte
}

// CreateAttachment ingests an uploaded image as a dedicated form attachment (origin
// 'form_attachment' from the start), binds it to the record and a validated image field, and
// records the value on the record. It never reclassifies an existing library asset. Authorization
// matches record editing.
func (s *Service) CreateAttachment(ctx context.Context, formID, recordID, actor uuid.UUID, upload AttachmentUpload) (Attachment, error) {
	meta, err := s.authorizeEdit(ctx, formID, recordID, actor)
	if err != nil {
		return Attachment{}, err
	}
	schema, err := s.revisionSchema(ctx, s.db, meta.revisionID)
	if err != nil {
		return Attachment{}, err
	}
	if !isImageField(schema, upload.FieldKey) {
		return Attachment{}, fmt.Errorf("%w: %q is not an image field in this form", ErrValidation, upload.FieldKey)
	}
	asset, err := s.media.IngestFormAttachment(ctx, actor, upload.FileName, upload.ContentType, upload.Data)
	if err != nil {
		if errors.Is(err, media.ErrUploadTooLarge) || errors.Is(err, media.ErrUnsupportedType) || isAttachmentInputError(err) {
			return Attachment{}, fmt.Errorf("%w: %v", ErrValidation, err)
		}
		return Attachment{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Attachment{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	attachmentID, err := s.bindAttachment(ctx, tx, recordID, asset.ID, upload.FieldKey)
	if err != nil {
		return Attachment{}, err
	}
	// Record the attachment id as the field's value so the projection and detail views resolve it.
	var valuesRaw []byte
	var version int
	if err := tx.QueryRow(ctx, `SELECT values,version FROM form_records WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).Scan(&valuesRaw, &version); err != nil {
		return Attachment{}, err
	}
	values := map[string]any{}
	if len(valuesRaw) > 0 {
		_ = json.Unmarshal(valuesRaw, &values)
	}
	values[upload.FieldKey] = asset.ID.String()
	encoded, _ := json.Marshal(values)
	actorName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `UPDATE form_records SET values=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1`, recordID, string(encoded)); err != nil {
		return Attachment{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "attachment_added", "", "", actor, actorName, upload.FieldKey); err != nil {
		return Attachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Attachment{}, err
	}
	return Attachment{ID: attachmentID, AssetID: asset.ID, FieldKey: upload.FieldKey}, nil
}

// bindAttachment links a form-attachment asset to a record and field, refusing library assets and
// assets already used by playlists, layouts, Widgets, or other records.
func (s *Service) bindAttachment(ctx context.Context, tx pgx.Tx, recordID, assetID uuid.UUID, fieldKey string) (uuid.UUID, error) {
	var origin string
	err := tx.QueryRow(ctx, `SELECT origin FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, assetID).Scan(&origin)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("%w: attachment asset does not exist", ErrValidation)
	}
	if err != nil {
		return uuid.Nil, err
	}
	if origin != "form_attachment" {
		return uuid.Nil, fmt.Errorf("%w: only dedicated form attachments may be attached", ErrValidation)
	}
	var used bool
	if err := tx.QueryRow(ctx, `SELECT
		EXISTS(SELECT 1 FROM playlist_items WHERE asset_id=$1)
		OR EXISTS(SELECT 1 FROM widgets WHERE asset_id=$1)
		OR EXISTS(SELECT 1 FROM layout_draft_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset'))
		OR EXISTS(SELECT 1 FROM layout_revision_dependencies WHERE dependency_id=$1 AND dependency_type IN('widget','asset'))
		OR EXISTS(SELECT 1 FROM form_record_attachments WHERE asset_id=$1 AND record_id<>$2)`, assetID, recordID).Scan(&used); err != nil {
		return uuid.Nil, err
	}
	if used {
		return uuid.Nil, fmt.Errorf("%w: the asset is already in use", ErrValidation)
	}
	attachmentID := uuid.New()
	err = tx.QueryRow(ctx, `INSERT INTO form_record_attachments(id,record_id,asset_id,field_key)
		VALUES($1,$2,$3,$4)
		ON CONFLICT(record_id,asset_id) DO UPDATE SET field_key=EXCLUDED.field_key
		RETURNING id`, attachmentID, recordID, assetID, fieldKey).Scan(&attachmentID)
	if err != nil {
		return uuid.Nil, err
	}
	return attachmentID, nil
}

func isImageField(schema FormSchema, key string) bool {
	for _, field := range schema.Fields {
		if field.Key == key {
			return field.Control == ControlImage
		}
	}
	return false
}

func isAttachmentInputError(err error) bool {
	message := err.Error()
	return strings.Contains(message, "must be images") || strings.Contains(message, "attachment is empty")
}

// ListRecords returns a filtered, paginated slice of a form's records. Callers without view_all
// see only their own submissions; callers who cannot view any records are refused.
func (s *Service) ListRecords(ctx context.Context, formID, viewer uuid.UUID, filter RecordFilter) (RecordPage, error) {
	if _, err := s.ensureForm(ctx, s.db, formID); err != nil {
		return RecordPage{}, err
	}
	canViewAll, err := s.allow(ctx, formID, viewer, CapViewAll)
	if err != nil {
		return RecordPage{}, err
	}
	if !canViewAll {
		canViewOwn, err := s.allow(ctx, formID, viewer, CapViewOwn)
		if err != nil {
			return RecordPage{}, err
		}
		if !canViewOwn {
			hasSubmit, err := s.allow(ctx, formID, viewer, CapSubmit)
			if err != nil {
				return RecordPage{}, err
			}
			canViewOwn = hasSubmit
		}
		if !canViewOwn {
			return RecordPage{}, ErrForbidden
		}
		filter.SubmittedBy = &viewer
	}
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 {
		filter.PageSize = 25
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	where := []string{"data_source_id=$1", "deleted_at IS NULL"}
	args := []any{formID}
	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if len(filter.States) > 0 {
		add("state_key = ANY($%d)", filter.States)
	}
	if filter.SubmittedBy != nil {
		add("submitted_by=$%d", *filter.SubmittedBy)
	}
	if q := strings.TrimSpace(filter.Search); q != "" {
		args = append(args, q)
		where = append(where, fmt.Sprintf("(display_title ILIKE '%%'||$%d||'%%' OR submitter_name ILIKE '%%'||$%d||'%%')", len(args), len(args)))
	}
	clause := strings.Join(where, " AND ")
	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM form_records WHERE `+clause, args...).Scan(&total); err != nil {
		return RecordPage{}, err
	}
	order := "created_at DESC,id DESC"
	switch filter.Sort {
	case "oldest":
		order = "created_at ASC,id ASC"
	case "priority":
		order = "priority DESC,created_at DESC"
	case "updated":
		order = "updated_at DESC,id DESC"
	}
	args = append(args, filter.PageSize, (filter.Page-1)*filter.PageSize)
	query := `SELECT id,data_source_id,revision_id,state_key,values,submitted_by,submitter_name,display_title,priority,display_at,expires_at,eligible,version,created_at,updated_at
		FROM form_records WHERE ` + clause + ` ORDER BY ` + order + fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return RecordPage{}, err
	}
	defer rows.Close()
	items := []Record{}
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return RecordPage{}, err
		}
		items = append(items, record)
	}
	if err := rows.Err(); err != nil {
		return RecordPage{}, err
	}
	return RecordPage{Items: items, Total: total, Page: filter.Page, PageSize: filter.PageSize}, nil
}

// GetRecord returns a record with its history, comments, and attachments, scoped to a form and
// visible only to a manager/reviewer or the record's own submitter. Records outside the form or
// invisible to the caller return ErrNotFound so existence is not revealed.
func (s *Service) GetRecord(ctx context.Context, formID, recordID, viewer uuid.UUID) (RecordDetail, error) {
	meta, err := s.loadRecordScoped(ctx, s.db, formID, recordID)
	if err != nil {
		return RecordDetail{}, err
	}
	canViewAll, err := s.allow(ctx, formID, viewer, CapViewAll)
	if err != nil {
		return RecordDetail{}, err
	}
	isOwner := meta.owner != nil && *meta.owner == viewer
	if !canViewAll && !isOwner {
		return RecordDetail{}, ErrNotFound
	}
	return s.recordDetail(ctx, recordID)
}

func (s *Service) recordDetail(ctx context.Context, recordID uuid.UUID) (RecordDetail, error) {
	record, err := s.getRecordRow(ctx, s.db, recordID)
	if err != nil {
		return RecordDetail{}, err
	}
	detail := RecordDetail{Record: record, Events: []RecordEvent{}, Comments: []RecordComment{}, Attachments: []Attachment{}}
	eventRows, err := s.db.Query(ctx, `SELECT id,event_type,from_state,to_state,actor_name,note,created_at
		FROM form_record_events WHERE record_id=$1 ORDER BY created_at DESC,id`, recordID)
	if err != nil {
		return RecordDetail{}, err
	}
	for eventRows.Next() {
		var event RecordEvent
		if err := eventRows.Scan(&event.ID, &event.EventType, &event.FromState, &event.ToState, &event.ActorName, &event.Note, &event.CreatedAt); err != nil {
			eventRows.Close()
			return RecordDetail{}, err
		}
		detail.Events = append(detail.Events, event)
	}
	eventRows.Close()
	commentRows, err := s.db.Query(ctx, `SELECT id,author_name,body,created_at FROM form_record_comments
		WHERE record_id=$1 AND deleted_at IS NULL ORDER BY created_at`, recordID)
	if err != nil {
		return RecordDetail{}, err
	}
	for commentRows.Next() {
		var comment RecordComment
		if err := commentRows.Scan(&comment.ID, &comment.AuthorName, &comment.Body, &comment.CreatedAt); err != nil {
			commentRows.Close()
			return RecordDetail{}, err
		}
		detail.Comments = append(detail.Comments, comment)
	}
	commentRows.Close()
	attachmentRows, err := s.db.Query(ctx, `SELECT id,asset_id,field_key FROM form_record_attachments WHERE record_id=$1 ORDER BY created_at`, recordID)
	if err != nil {
		return RecordDetail{}, err
	}
	defer attachmentRows.Close()
	for attachmentRows.Next() {
		var attachment Attachment
		if err := attachmentRows.Scan(&attachment.ID, &attachment.AssetID, &attachment.FieldKey); err != nil {
			return RecordDetail{}, err
		}
		detail.Attachments = append(detail.Attachments, attachment)
	}
	return detail, attachmentRows.Err()
}

func (s *Service) getRecordRow(ctx context.Context, q rowQuerier, recordID uuid.UUID) (Record, error) {
	row := q.QueryRow(ctx, `SELECT id,data_source_id,revision_id,state_key,values,submitted_by,submitter_name,display_title,priority,display_at,expires_at,eligible,version,created_at,updated_at
		FROM form_records WHERE id=$1 AND deleted_at IS NULL`, recordID)
	record, err := scanRecord(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return record, err
}

type scanner interface{ Scan(dest ...any) error }

func scanRecord(row scanner) (Record, error) {
	var record Record
	var valuesRaw []byte
	if err := row.Scan(&record.ID, &record.DataSourceID, &record.RevisionID, &record.State, &valuesRaw,
		&record.SubmittedBy, &record.SubmitterName, &record.DisplayTitle, &record.Priority,
		&record.DisplayAt, &record.ExpiresAt, &record.Eligible, &record.Version, &record.CreatedAt, &record.UpdatedAt); err != nil {
		return Record{}, err
	}
	record.Values = map[string]any{}
	if len(valuesRaw) > 0 {
		_ = json.Unmarshal(valuesRaw, &record.Values)
	}
	return record, nil
}

func initialStateKey(ctx context.Context, q rowQuerier, formID uuid.UUID) (string, error) {
	var state string
	err := q.QueryRow(ctx, `SELECT state_key FROM form_workflow_states WHERE data_source_id=$1 AND is_initial ORDER BY position LIMIT 1`, formID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return "draft", nil
	}
	return state, err
}

func insertEvent(ctx context.Context, tx pgx.Tx, recordID, formID uuid.UUID, eventType, from, to string, actor uuid.UUID, actorName, note string) error {
	_, err := tx.Exec(ctx, `INSERT INTO form_record_events(id,record_id,data_source_id,event_type,from_state,to_state,actor_id,actor_name,note)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.New(), recordID, formID, eventType, from, to, actor, actorName, note)
	return err
}
