package forms

import (
	"context"

	"github.com/google/uuid"
)

// ListAccessibleForms returns every Form Data Source the user may see, decorated with the user's
// effective capabilities and their own submission counts. A global Owner sees all forms; everyone
// else sees forms they created or hold any grant on. This backs the lightweight Forms portal and
// the operator navigation, so it deliberately avoids loading full form detail per row.
func (s *Service) ListAccessibleForms(ctx context.Context, userID uuid.UUID) ([]FormSummary, error) {
	role, err := s.userGlobalRole(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	isOwner := role == "owner"
	rows, err := s.db.Query(ctx, `SELECT ds.id,ds.name,ds.description,ds.created_by,
			(SELECT max(revision_number) FROM form_revisions r WHERE r.data_source_id=ds.id) AS published
		FROM data_sources ds
		WHERE ds.provider='form' AND ds.deleted_at IS NULL
		AND ($2 OR ds.created_by=$1 OR EXISTS(SELECT 1 FROM form_grants g WHERE g.data_source_id=ds.id AND g.user_id=$1))
		ORDER BY ds.name,ds.id`, userID, isOwner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		id          uuid.UUID
		name        string
		description string
		createdBy   *uuid.UUID
		published   *int
	}
	scanned := []row{}
	for rows.Next() {
		var rec row
		if err := rows.Scan(&rec.id, &rec.name, &rec.description, &rec.createdBy, &rec.published); err != nil {
			return nil, err
		}
		scanned = append(scanned, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	summaries := make([]FormSummary, 0, len(scanned))
	for _, rec := range scanned {
		capabilities, err := s.grantedCapabilities(ctx, s.db, rec.id, rec.createdBy, userID)
		if err != nil {
			return nil, err
		}
		counts, err := s.ownSubmissionCounts(ctx, rec.id, userID)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, FormSummary{
			ID:                      rec.id,
			Name:                    rec.name,
			Description:             rec.description,
			PublishedRevisionNumber: rec.published,
			Capabilities:            capabilities,
			Counts:                  counts,
		})
	}
	return summaries, nil
}

// ownSubmissionCounts buckets a user's own submissions on one form by the workflow-derived meaning
// of each state: the initial state is a draft; any other state that a submitter can still edit
// (an outgoing submit transition) is "changes requested"; everything else is "submitted".
func (s *Service) ownSubmissionCounts(ctx context.Context, formID, userID uuid.UUID) (SubmissionCounts, error) {
	var counts SubmissionCounts
	err := s.db.QueryRow(ctx, `SELECT
			count(*) FILTER (WHERE category='draft'),
			count(*) FILTER (WHERE category='changes_requested'),
			count(*) FILTER (WHERE category='submitted'),
			count(*)
		FROM (
			SELECT CASE
				WHEN COALESCE(st.is_initial,FALSE) THEN 'draft'
				WHEN EXISTS(SELECT 1 FROM form_workflow_transitions t
					WHERE t.data_source_id=r.data_source_id AND t.from_state=r.state_key AND t.required_capability='submit') THEN 'changes_requested'
				ELSE 'submitted'
			END AS category
			FROM form_records r
			LEFT JOIN form_workflow_states st ON st.data_source_id=r.data_source_id AND st.state_key=r.state_key
			WHERE r.data_source_id=$1 AND r.submitted_by=$2 AND r.deleted_at IS NULL
		) categorized`, formID, userID).Scan(&counts.Draft, &counts.ChangesRequested, &counts.Submitted, &counts.Total)
	if err != nil {
		return SubmissionCounts{}, err
	}
	return counts, nil
}
