package forms

import (
	"context"

	"github.com/google/uuid"
)

// ApprovalFilter bounds the central approvals inbox.
type ApprovalFilter struct {
	Limit int
}

// PendingApprovals returns records awaiting a review decision across every Form Data Source the
// user may review, approve, or manage. A record is pending when its current state has an outgoing
// transition that requires the review or approve capability.
func (s *Service) PendingApprovals(ctx context.Context, userID uuid.UUID, filter ApprovalFilter) ([]ApprovalItem, error) {
	if filter.Limit <= 0 || filter.Limit > 500 {
		filter.Limit = 200
	}
	role, err := s.userGlobalRole(ctx, s.db, userID)
	if err != nil {
		return nil, err
	}
	isOwner := role == "owner"
	rows, err := s.db.Query(ctx, `SELECT r.id,r.data_source_id,ds.name,r.display_title,r.submitter_name,r.state_key,r.display_at,r.expires_at,r.created_at
		FROM form_records r
		JOIN data_sources ds ON ds.id=r.data_source_id AND ds.deleted_at IS NULL AND ds.provider='form'
		WHERE r.deleted_at IS NULL
		AND EXISTS(SELECT 1 FROM form_workflow_transitions t
			WHERE t.data_source_id=r.data_source_id AND t.from_state=r.state_key AND t.required_capability IN ('review','approve'))
		AND (
			$2
			OR ds.created_by=$1
			OR EXISTS(SELECT 1 FROM form_grants g
				WHERE g.data_source_id=r.data_source_id AND g.user_id=$1 AND g.capability IN ('review','approve','manage'))
		)
		ORDER BY r.created_at ASC
		LIMIT $3`, userID, isOwner, filter.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ApprovalItem{}
	for rows.Next() {
		var item ApprovalItem
		if err := rows.Scan(&item.RecordID, &item.DataSourceID, &item.FormName, &item.Title, &item.SubmitterName, &item.State, &item.DisplayAt, &item.ExpiresAt, &item.SubmittedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
