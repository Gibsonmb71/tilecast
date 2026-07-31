// Package approvals gates content that is about to reach a screen.
//
// The model is a decision about a revision, not a submission workflow. Content
// is pending review when its current revision has no approval; it is approved
// when an approval exists for exactly that revision. Editing bumps the revision
// and therefore re-opens review on its own, so no edit path has to remember to
// re-submit anything.
package approvals

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
)

// Content types that can be reviewed. These are the two things that can be
// assigned to a screen; everything else in the library reaches a screen only
// through one of them.
const (
	TypePlaylist = "playlist"
	TypeLayout   = "layout"
)

var (
	// ErrNotApproved means the content may not be assigned yet.
	ErrNotApproved = errors.New("content is waiting for review")
	// ErrValidation marks a bad request.
	ErrValidation = errors.New("review request is not valid")
	// ErrNotFound is returned for unknown content.
	ErrNotFound = errors.New("not found")
)

// SettingsReader is the part of the settings service this package needs.
type SettingsReader interface {
	Organization(ctx context.Context) (settings.Document, error)
}

// Querier is the part of pgx that both a pool and a transaction satisfy, so the
// gate can run on its own or inside a caller's assignment transaction.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Service records review decisions and answers whether content may be used.
type Service struct {
	db       *pgxpool.Pool
	settings SettingsReader
}

// NewService builds the approvals service.
func NewService(db *pgxpool.Pool, reader SettingsReader) *Service {
	return &Service{db: db, settings: reader}
}

// Required reports whether this installation gates assignment on review.
//
// Off by default. An existing installation that upgrades must not suddenly find
// every playlist unassignable.
func (s *Service) Required(ctx context.Context) bool {
	document, err := s.settings.Organization(ctx)
	if err != nil {
		// A settings read failure must not turn into a fleet-wide assignment
		// block. Failing open here matches the enrollment-policy rule: an
		// unreadable policy value means "not required".
		return false
	}
	required, _ := document.Values["content.approval_required"].(bool)
	return required
}

// Gate returns nil when the content may be assigned to a screen.
//
// This is the advisory form, for a caller that only reports what would happen —
// the bulk preview. A caller that is about to write the assignment must use
// GateTx instead, so the answer cannot go stale before it commits.
func (s *Service) Gate(ctx context.Context, contentType string, id uuid.UUID) error {
	return s.gate(ctx, s.db, contentType, id, false)
}

// GateTx is the gate inside the caller's assignment transaction, and it is what
// every path that actually writes an assignment uses. Being in the assignment
// path rather than the HTTP layer is what makes single assignment, bulk
// assignment, and anything added later share one check.
//
// Reading the revision without a lock leaves a window: an edit that lands
// between the check and the assignment's commit puts content on a screen whose
// approval names the revision before the edit. The share lock closes it. A
// concurrent edit blocks until the assignment commits and then bumps the
// revision, which re-opens review the same way any other edit does. Share
// rather than exclusive, so two assignments of the same playlist still proceed
// together — they are not what has to be serialized here.
func (s *Service) GateTx(ctx context.Context, tx pgx.Tx, contentType string, id uuid.UUID) error {
	return s.gate(ctx, tx, contentType, id, true)
}

func (s *Service) gate(ctx context.Context, q Querier, contentType string, id uuid.UUID, lock bool) error {
	if !s.Required(ctx) {
		return nil
	}
	revision, err := s.currentRevision(ctx, q, contentType, id, lock)
	if errors.Is(err, ErrNotFound) {
		// Existence is the assignment path's business, not this one's.
		return nil
	}
	if err != nil {
		return err
	}
	var approved bool
	if err := q.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM content_reviews
			WHERE content_type=$1 AND content_id=$2 AND revision=$3 AND decision='approved')`,
		contentType, id, revision).Scan(&approved); err != nil {
		return err
	}
	if approved {
		return nil
	}
	return errUnapproved(contentType)
}

func errUnapproved(contentType string) error {
	return fmt.Errorf("%w: this %s has not been approved at its current revision",
		ErrNotApproved, contentType)
}

// currentRevision reads the revision a decision would apply to. For a Layout
// that is the published revision: an unpublished draft cannot be assigned in
// the first place, so there is nothing to review.
//
// With lock set it takes a share lock on the one row an edit writes: the
// playlists row, whose revision an edit bumps, or the layouts row, whose
// published_revision_id a publish moves. Locking the revision row instead would
// lock nothing useful, because a publish leaves the old revision untouched and
// points elsewhere.
func (s *Service) currentRevision(ctx context.Context, q Querier, contentType string, id uuid.UUID, lock bool) (int64, error) {
	query, err := revisionQuery(contentType, lock)
	if err != nil {
		return 0, err
	}
	var revision int64
	err = q.QueryRow(ctx, query, id).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return revision, err
}

func revisionQuery(contentType string, lock bool) (string, error) {
	switch contentType {
	case TypePlaylist:
		query := `SELECT revision FROM playlists WHERE id=$1 AND deleted_at IS NULL`
		if lock {
			query += ` FOR SHARE`
		}
		return query, nil
	case TypeLayout:
		query := `SELECT r.revision FROM layouts l
		         JOIN layout_revisions r ON r.id=l.published_revision_id
		         WHERE l.id=$1 AND l.deleted_at IS NULL`
		if lock {
			// OF l, not the revision row: a publish leaves the old revision
			// untouched and moves layouts.published_revision_id, so the layouts row
			// is the one an assignment has to hold.
			query += ` FOR SHARE OF l`
		}
		return query, nil
	default:
		return "", fmt.Errorf("%w: unknown content type %q", ErrValidation, contentType)
	}
}

// Decide records an approval or a rejection for the content's current revision.
//
// The revision is read here rather than taken from the caller, so a decision
// can never be recorded against a revision the reviewer did not see. If the
// content changed while the review was open, the reviewer is told.
func (s *Service) Decide(ctx context.Context, reviewer uuid.UUID, contentType string, id uuid.UUID, approve bool, note string, expectedRevision int64) (Review, error) {
	// Unlocked on purpose. An edit that lands after this read leaves the decision
	// recorded against the revision the reviewer saw, which is exactly a
	// superseded decision: the content reads as pending again. The failure mode of
	// locking here would be a reviewer holding an editor's save open.
	revision, err := s.currentRevision(ctx, s.db, contentType, id, false)
	if err != nil {
		return Review{}, err
	}
	if expectedRevision > 0 && expectedRevision != revision {
		return Review{}, fmt.Errorf("%w: this %s changed while you were reviewing it. Look at it again.",
			ErrValidation, contentType)
	}
	note = strings.TrimSpace(note)
	if !approve && note == "" {
		// A rejection with no reason leaves the author with nothing to act on.
		return Review{}, fmt.Errorf("%w: say why it is being sent back", ErrValidation)
	}
	decision := "rejected"
	if approve {
		decision = "approved"
	}

	review := Review{
		ID: uuid.New(), ContentType: contentType, ContentID: id,
		Revision: revision, Decision: decision, Note: note,
		ReviewedBy: &reviewer, ReviewedAt: time.Now().UTC(),
	}
	// Re-deciding the same revision replaces the decision, which is how a
	// rejection is reversed without inventing a third state.
	if _, err := s.db.Exec(ctx, `
		INSERT INTO content_reviews(id,content_type,content_id,revision,decision,note,reviewed_by)
		VALUES($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (content_type,content_id,revision) DO UPDATE SET
			decision=EXCLUDED.decision, note=EXCLUDED.note,
			reviewed_by=EXCLUDED.reviewed_by, reviewed_at=now()`,
		review.ID, contentType, id, revision, decision, note, reviewer); err != nil {
		return Review{}, err
	}
	return review, nil
}

// Review is one recorded decision.
type Review struct {
	ID          uuid.UUID  `json:"id"`
	ContentType string     `json:"contentType"`
	ContentID   uuid.UUID  `json:"contentId"`
	Revision    int64      `json:"revision"`
	Decision    string     `json:"decision"`
	Note        string     `json:"note,omitempty"`
	ReviewedBy  *uuid.UUID `json:"reviewedBy,omitempty"`
	ReviewedAt  time.Time  `json:"reviewedAt"`
}

// QueueItem is one piece of content and where it stands.
type QueueItem struct {
	ContentType string    `json:"contentType"`
	ContentID   uuid.UUID `json:"contentId"`
	Name        string    `json:"name"`
	Revision    int64     `json:"revision"`
	// State is pending, approved, or rejected, derived from whether a decision
	// exists for this exact revision.
	State string `json:"state"`
	// AssignedScreens is why a reviewer should care: content already on screens
	// that has since been edited is more urgent than a new draft.
	AssignedScreens int        `json:"assignedScreens"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	AuthorName      string     `json:"authorName,omitempty"`
	LastNote        string     `json:"lastNote,omitempty"`
	LastReviewedAt  *time.Time `json:"lastReviewedAt,omitempty"`
}

// Queue lists reviewable content with its current state.
//
// Both playlists and published Layouts appear. An unpublished Layout draft is
// left out: it cannot reach a screen, so there is nothing to decide yet.
func (s *Service) Queue(ctx context.Context, state string) ([]QueueItem, error) {
	rows, err := s.db.Query(ctx, `
		WITH reviewable AS (
			SELECT 'playlist'::text AS content_type, p.id, p.name, p.revision, p.updated_at,
			       p.created_by,
			       (SELECT count(*) FROM screen_playlist_assignments a WHERE a.playlist_id=p.id)
			     + (SELECT count(*) FROM screen_group_memberships m
			        JOIN screen_group_playlist_assignments g ON g.screen_group_id=m.screen_group_id
			        WHERE g.playlist_id=p.id) AS assigned
			FROM playlists p WHERE p.deleted_at IS NULL
			UNION ALL
			SELECT 'layout', l.id, l.name, r.revision, l.updated_at, l.created_by,
			       (SELECT count(*) FROM screen_playlist_assignments a WHERE a.layout_id=l.id)
			     + (SELECT count(*) FROM screen_group_memberships m
			        JOIN screen_group_playlist_assignments g ON g.screen_group_id=m.screen_group_id
			        WHERE g.layout_id=l.id)
			FROM layouts l
			JOIN layout_revisions r ON r.id=l.published_revision_id
			WHERE l.deleted_at IS NULL
		)
		SELECT v.content_type, v.id, v.name, v.revision, v.updated_at,
		       COALESCE(u.name,''), v.assigned,
		       COALESCE(cr.decision,'pending'), COALESCE(cr.note,''), cr.reviewed_at
		FROM reviewable v
		LEFT JOIN users u ON u.id=v.created_by
		LEFT JOIN content_reviews cr
			ON cr.content_type=v.content_type AND cr.content_id=v.id AND cr.revision=v.revision
		WHERE $1='' OR COALESCE(cr.decision,'pending')=$1
		ORDER BY v.assigned DESC, v.updated_at DESC
		LIMIT 200`, state)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QueueItem{}
	for rows.Next() {
		var item QueueItem
		if err := rows.Scan(&item.ContentType, &item.ContentID, &item.Name, &item.Revision,
			&item.UpdatedAt, &item.AuthorName, &item.AssignedScreens,
			&item.State, &item.LastNote, &item.LastReviewedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// PendingCount is what Studio shows as a badge.
func (s *Service) PendingCount(ctx context.Context) (int, error) {
	items, err := s.Queue(ctx, "pending")
	return len(items), err
}
