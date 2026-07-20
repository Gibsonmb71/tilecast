package forms

import (
	"context"

	"github.com/google/uuid"
)

// ApprovalFilter bounds and paginates the central approvals inbox.
type ApprovalFilter struct {
	Page     int
	PageSize int
}

// PendingApprovals returns a paginated page of records awaiting a review decision across every Form
// Data Source the user may review, approve, or manage. A record is pending when its current state
// has an outgoing transition that requires the review or approve capability. Results are paginated
// (with a total count) rather than silently capped, so no pending item is ever hidden by a limit.
func (s *Service) PendingApprovals(ctx context.Context, userID uuid.UUID, filter ApprovalFilter) (ApprovalPage, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.PageSize < 1 {
		filter.PageSize = 25
	}
	if filter.PageSize > 100 {
		filter.PageSize = 100
	}
	role, err := s.userGlobalRole(ctx, s.db, userID)
	if err != nil {
		return ApprovalPage{}, err
	}
	isOwner := role == "owner"

	// Shared FROM + authorization/pending predicate for both the count and the page query. The
	// LEFT JOIN to states supplies the human-readable state label and never changes the row count.
	const from = `FROM form_records r
		JOIN data_sources ds ON ds.id=r.data_source_id AND ds.deleted_at IS NULL AND ds.provider='form'
		LEFT JOIN form_workflow_states st ON st.data_source_id=r.data_source_id AND st.state_key=r.state_key
		WHERE r.deleted_at IS NULL
		AND EXISTS(SELECT 1 FROM form_workflow_transitions t
			WHERE t.data_source_id=r.data_source_id AND t.from_state=r.state_key AND t.required_capability IN ('review','approve'))
		AND (
			$2
			OR ds.created_by=$1
			OR EXISTS(SELECT 1 FROM form_grants g
				WHERE g.data_source_id=r.data_source_id AND g.user_id=$1 AND g.capability IN ('review','approve','manage'))
		)`

	var total int
	if err := s.db.QueryRow(ctx, `SELECT count(*) `+from, userID, isOwner).Scan(&total); err != nil {
		return ApprovalPage{}, err
	}

	rows, err := s.db.Query(ctx, `SELECT r.id,r.data_source_id,ds.name,r.display_title,r.submitter_name,r.state_key,
			COALESCE(st.label,r.state_key),r.display_at,r.expires_at,r.created_at
		`+from+`
		ORDER BY r.created_at ASC
		LIMIT $3 OFFSET $4`, userID, isOwner, filter.PageSize, (filter.Page-1)*filter.PageSize)
	if err != nil {
		return ApprovalPage{}, err
	}
	defer rows.Close()
	items := []ApprovalItem{}
	for rows.Next() {
		var item ApprovalItem
		if err := rows.Scan(&item.RecordID, &item.DataSourceID, &item.FormName, &item.Title, &item.SubmitterName, &item.State, &item.StateLabel, &item.DisplayAt, &item.ExpiresAt, &item.SubmittedAt); err != nil {
			return ApprovalPage{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return ApprovalPage{}, err
	}
	return ApprovalPage{Items: items, Total: total, Page: filter.Page, PageSize: filter.PageSize}, nil
}
