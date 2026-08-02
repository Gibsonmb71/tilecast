package playlists

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/approvals"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
)

// approvalAlwaysRequired is the settings answer for an installation that gates
// assignment on review. The real reader is the settings service; the gate only
// asks it one question.
type approvalAlwaysRequired struct{}

func (approvalAlwaysRequired) Organization(context.Context) (settings.Document, error) {
	return settings.Document{Values: map[string]any{"content.approval_required": true}}, nil
}

// TestApprovalGateIsAtomicWithTheAssignment proves the review check and the
// assignment it guards cannot be separated.
//
// The check reads the content's current revision and the assignment writes a row
// naming the content. Between those two, an edit bumps the revision. If the
// check runs outside the assignment's transaction, an assignment that passed the
// gate at revision N commits after the content has become revision N+1, and
// content nobody reviewed is on a screen while the approval on file names the
// revision before the edit.
//
// The gate closes that by taking a share lock on the row an edit writes, inside
// the assignment's own transaction. This test holds that row the way an edit in
// flight does and shows the assignment waits for it rather than committing
// around it.
func TestApprovalGateIsAtomicWithTheAssignment(t *testing.T) {
	f := setupCapabilityFixture(t)
	review := approvals.NewService(f.pool, approvalAlwaysRequired{})
	f.service.SetApprovalGate(review.GateTx)

	playlist, err := f.service.Create(f.ctx, f.user, "Morning Announcements", "", "static")
	if err != nil {
		t.Fatalf("create playlist: %v", err)
	}
	f.addReadyImageToPlaylist(t, playlist.ID)

	// Unreviewed content is refused, which is the gate working at all.
	if _, err := f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); !errors.Is(err, approvals.ErrNotApproved) {
		t.Fatalf("assigning unreviewed content = %v, want ErrNotApproved", err)
	}
	if _, err := review.Decide(f.ctx, f.user, approvals.TypePlaylist, playlist.ID, true, "", 0); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if _, err := f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); err != nil {
		t.Fatalf("assigning approved content: %v", err)
	}

	// An edit in flight: another transaction holds the playlists row the way
	// `UPDATE playlists SET revision=revision+1` does, and has not committed.
	edit, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer edit.Rollback(f.ctx) //nolint:errcheck
	if _, err := edit.Exec(f.ctx, `SELECT revision FROM playlists WHERE id=$1 FOR UPDATE`, playlist.ID); err != nil {
		t.Fatalf("hold the content row: %v", err)
	}

	blocked, cancel := context.WithTimeout(f.ctx, 750*time.Millisecond)
	defer cancel()
	if _, err := f.service.Assign(blocked, f.screen, playlist.ID, f.user); err == nil {
		t.Error("the assignment committed while an edit to the same content was in flight")
	}

	// Let the edit land. It bumps the revision, which re-opens review, and the
	// assignment that was waiting on it is now refused for the right reason
	// rather than having committed a revision nobody read.
	if _, err := edit.Exec(f.ctx, `UPDATE playlists SET revision=revision+1,updated_at=now() WHERE id=$1`, playlist.ID); err != nil {
		t.Fatalf("bump the revision: %v", err)
	}
	if err := edit.Commit(f.ctx); err != nil {
		t.Fatalf("commit the edit: %v", err)
	}
	if _, err := f.service.Assign(f.ctx, f.screen, playlist.ID, f.user); !errors.Is(err, approvals.ErrNotApproved) {
		t.Errorf("assigning after the edit = %v, want ErrNotApproved", err)
	}
}

// TestSyncGroupAssignmentPassesTheApprovalGate covers the third assignment path.
// A sync group assignment reaches every screen in the group, so unreviewed
// content must not travel through it either.
func TestSyncGroupAssignmentPassesTheApprovalGate(t *testing.T) {
	f := setupCapabilityFixture(t)
	review := approvals.NewService(f.pool, approvalAlwaysRequired{})
	f.service.SetApprovalGate(review.GateTx)

	playlist, err := f.service.Create(f.ctx, f.user, "Gym Board", "", "static")
	if err != nil {
		t.Fatalf("create playlist: %v", err)
	}
	f.addReadyImageToPlaylist(t, playlist.ID)
	group := uuid.New()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO screen_groups(id,organization_id,name,created_by)VALUES($1,$2,'East Wing',$3)`, group, f.org, f.user); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO screen_group_memberships(screen_group_id,screen_id,added_by)VALUES($1,$2,$3)`, group, f.screen, f.user); err != nil {
		t.Fatal(err)
	}

	if err := f.service.AssignGroup(f.ctx, group, playlist.ID, f.user); !errors.Is(err, approvals.ErrNotApproved) {
		t.Fatalf("assigning unreviewed content to a sync group = %v, want ErrNotApproved", err)
	}
	if _, err := review.Decide(f.ctx, f.user, approvals.TypePlaylist, playlist.ID, true, "", 0); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if err := f.service.AssignGroup(f.ctx, group, playlist.ID, f.user); err != nil {
		t.Fatalf("assigning approved content to a sync group: %v", err)
	}
}
