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
)

// RecordInput carries submitted or edited record values and display metadata.
type RecordInput struct {
	Values       map[string]any
	DisplayTitle *string
	Priority     *int
	DisplayAt    *time.Time
	ExpiresAt    *time.Time
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

// CreateRecord creates a draft submission bound to the form's current published revision.
func (s *Service) CreateRecord(ctx context.Context, id, actor uuid.UUID, in RecordInput) (Record, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return Record{}, err
	}
	revision, err := s.loadPublishedRevision(ctx, s.db, id)
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
	initialState, err := initialStateKey(ctx, s.db, id)
	if err != nil {
		return Record{}, err
	}
	encoded, _ := json.Marshal(values)
	recordID := uuid.New()
	displayTitle := ""
	if in.DisplayTitle != nil {
		displayTitle = strings.TrimSpace(*in.DisplayTitle)
	}
	priority := 0
	if in.Priority != nil {
		priority = *in.Priority
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	submitterName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `INSERT INTO form_records(id,data_source_id,revision_id,state_key,values,submitted_by,submitter_name,display_title,priority,display_at,expires_at,eligible,version)
		VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,FALSE,1)`,
		recordID, id, revision.ID, initialState, string(encoded), actor, submitterName, displayTitle, priority, in.DisplayAt, in.ExpiresAt); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, recordID, id, "created", "", initialState, actor, submitterName, ""); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	return s.getRecordRow(ctx, s.db, recordID)
}

// UpdateRecord edits a record's values and display metadata under optimistic concurrency. If the
// record is currently output-eligible, the projection is rebuilt so signage stays in agreement.
func (s *Service) UpdateRecord(ctx context.Context, recordID, actor uuid.UUID, in RecordInput, expectedVersion int) (Record, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Record{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var formID, revisionID uuid.UUID
	var version int
	var stateKey string
	var eligible bool
	err = tx.QueryRow(ctx, `SELECT data_source_id,revision_id,version,state_key,eligible FROM form_records
		WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).Scan(&formID, &revisionID, &version, &stateKey, &eligible)
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
	actorName := s.userName(ctx, tx, actor)
	if _, err := tx.Exec(ctx, `UPDATE form_records SET values=$2::jsonb,
		display_title=COALESCE($3,display_title),priority=COALESCE($4,priority),
		display_at=$5,expires_at=$6,version=version+1,updated_at=now()
		WHERE id=$1`,
		recordID, string(encoded), trimmedPtr(in.DisplayTitle), in.Priority, in.DisplayAt, in.ExpiresAt); err != nil {
		return Record{}, err
	}
	if err := insertEvent(ctx, tx, recordID, formID, "edited", stateKey, stateKey, actor, actorName, ""); err != nil {
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

// Transition moves a record to a new state, enforcing the configured workflow, per-form
// authorization for the transition's capability, optimistic concurrency, and required-field
// completeness when entering an output-eligible state. It records history and rebuilds the
// projection so approvals reach signage and manifests are invalidated.
func (s *Service) Transition(ctx context.Context, recordID, actor uuid.UUID, toState, note string, expectedVersion int) (Record, error) {
	// Resolve the record's form and current state first so we can authorize the specific
	// transition's capability before opening the write transaction.
	var formID uuid.UUID
	var currentState string
	err := s.db.QueryRow(ctx, `SELECT data_source_id,state_key FROM form_records WHERE id=$1 AND deleted_at IS NULL`, recordID).Scan(&formID, &currentState)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	var requiredCapability string
	var transitionLabel string
	err = s.db.QueryRow(ctx, `SELECT required_capability,label FROM form_workflow_transitions
		WHERE data_source_id=$1 AND from_state=$2 AND to_state=$3`, formID, currentState, toState).Scan(&requiredCapability, &transitionLabel)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, fmt.Errorf("%w: no transition from %q to %q", ErrValidation, currentState, toState)
	}
	if err != nil {
		return Record{}, err
	}
	allowed, err := s.Authorize(ctx, formID, actor, Capability(requiredCapability))
	if err != nil {
		return Record{}, err
	}
	if !allowed {
		return Record{}, ErrForbidden
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
	if lockedState != currentState {
		// The state changed between our read and the lock; the transition is no longer valid.
		return Record{}, ErrConflict
	}
	// Entering an output-eligible state requires a complete, valid submission.
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
	if err := insertEvent(ctx, tx, recordID, formID, "transition", currentState, toState, actor, actorName, note); err != nil {
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
		uuid.New(), actor, formID.String(), recordID.String(), currentState, toState); err != nil {
		return Record{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Record{}, err
	}
	// State/eligibility changed, so rebuild the projection (which invalidates affected manifests).
	if err := s.RebuildProjection(ctx, formID); err != nil {
		return Record{}, err
	}
	return s.getRecordRow(ctx, s.db, recordID)
}

// DeleteRecord soft-deletes a record and rebuilds the projection when the record was eligible.
func (s *Service) DeleteRecord(ctx context.Context, recordID, actor uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var formID uuid.UUID
	var eligible bool
	err = tx.QueryRow(ctx, `SELECT data_source_id,eligible FROM form_records WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, recordID).Scan(&formID, &eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
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

// AddComment records a reviewer/submitter comment on a record.
func (s *Service) AddComment(ctx context.Context, recordID, actor uuid.UUID, body string) (RecordComment, error) {
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 4000 {
		return RecordComment{}, fmt.Errorf("%w: comment must be between 1 and 4000 characters", ErrValidation)
	}
	var formID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT data_source_id FROM form_records WHERE id=$1 AND deleted_at IS NULL`, recordID).Scan(&formID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RecordComment{}, ErrNotFound
		}
		return RecordComment{}, err
	}
	actorName := s.userName(ctx, s.db, actor)
	commentID := uuid.New()
	if _, err := s.db.Exec(ctx, `INSERT INTO form_record_comments(id,record_id,author_id,author_name,body) VALUES($1,$2,$3,$4,$5)`,
		commentID, recordID, actor, actorName, body); err != nil {
		return RecordComment{}, err
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO form_record_events(id,record_id,data_source_id,event_type,from_state,to_state,actor_id,actor_name,note)
		VALUES($1,$2,$3,'comment','','',$4,$5,$6)`, uuid.New(), recordID, formID, actor, actorName, body)
	return RecordComment{ID: commentID, AuthorName: actorName, Body: body, CreatedAt: time.Now().UTC()}, nil
}

// ListRecords returns a filtered, paginated slice of a form's records.
func (s *Service) ListRecords(ctx context.Context, id uuid.UUID, filter RecordFilter) (RecordPage, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return RecordPage{}, err
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
	args := []any{id}
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

// GetRecord returns a record with its history, comments, and attachments.
func (s *Service) GetRecord(ctx context.Context, recordID uuid.UUID) (RecordDetail, error) {
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

func trimmedPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}
