package approvals

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
)

type stubSettings struct {
	values map[string]any
	err    error
}

func (s stubSettings) Organization(context.Context) (settings.Document, error) {
	return settings.Document{Values: s.values}, s.err
}

func TestApprovalIsOffByDefault(t *testing.T) {
	// An installation that upgrades must not find every playlist unassignable.
	svc := NewService(nil, stubSettings{values: map[string]any{}})
	if svc.Required(context.Background()) {
		t.Error("approval must default to off")
	}
}

func TestApprovalReadsTheSetting(t *testing.T) {
	svc := NewService(nil, stubSettings{values: map[string]any{"content.approval_required": true}})
	if !svc.Required(context.Background()) {
		t.Error("the setting was not read")
	}
}

func TestUnreadableSettingsDoNotBlockTheFleet(t *testing.T) {
	// Same rule as the MFA enrollment policy: an unreadable policy value means
	// "not required". Failing closed here would make a settings outage look
	// like every playlist being unapprovable.
	svc := NewService(nil, stubSettings{err: errors.New("database is unreachable")})
	if svc.Required(context.Background()) {
		t.Error("a settings failure must not gate assignment")
	}
}

func TestGateIsANoOpWhenApprovalIsOff(t *testing.T) {
	// No database is wired in, so reaching a query at all would panic. Passing
	// proves the gate short-circuits before touching one.
	svc := NewService(nil, stubSettings{values: map[string]any{}})
	if err := svc.Gate(context.Background(), TypePlaylist, testUUID()); err != nil {
		t.Errorf("Gate = %v, want nil", err)
	}
}

func TestUnknownContentTypeIsRejected(t *testing.T) {
	svc := NewService(nil, stubSettings{values: map[string]any{"content.approval_required": true}})
	_, err := svc.currentRevision(context.Background(), nil, "screen", testUUID(), false)
	if !errors.Is(err, ErrValidation) {
		t.Errorf("currentRevision = %v, want a validation error", err)
	}
}

func TestTheGatedRevisionReadLocksTheRowAnEditWrites(t *testing.T) {
	// Without the lock the gate answers about a revision that can change before
	// the assignment commits. The lock has to name the row an edit actually
	// writes: the playlists row, or the layouts row a publish repoints. Locking
	// layout_revisions would block nothing, because a publish inserts a new
	// revision rather than changing the old one.
	for _, testCase := range []struct{ contentType, want string }{
		{TypePlaylist, "FOR SHARE"},
		{TypeLayout, "FOR SHARE OF l"},
	} {
		query, err := revisionQuery(testCase.contentType, true)
		if err != nil {
			t.Fatalf("revisionQuery(%s) = %v", testCase.contentType, err)
		}
		if !strings.HasSuffix(query, testCase.want) {
			t.Errorf("%s locked with %q, want a %q suffix", testCase.contentType, query, testCase.want)
		}
	}
}

func TestTheAdvisoryRevisionReadTakesNoLock(t *testing.T) {
	// The preview and the reviewer's own read must not hold an editor's save open.
	for _, contentType := range []string{TypePlaylist, TypeLayout} {
		query, err := revisionQuery(contentType, false)
		if err != nil {
			t.Fatalf("revisionQuery(%s) = %v", contentType, err)
		}
		if strings.Contains(query, "FOR SHARE") {
			t.Errorf("%s read unlocked still locks: %q", contentType, query)
		}
	}
}

func testUUID() uuid.UUID { return uuid.MustParse("11111111-1111-1111-1111-111111111111") }

func TestNotApprovedErrorNamesTheContentType(t *testing.T) {
	// The message reaches an operator through a 409, so it has to read as a
	// sentence about their playlist, not as an error chain.
	err := errUnapproved(TypePlaylist)
	if !strings.Contains(err.Error(), "playlist") {
		t.Errorf("error = %q", err)
	}
	if !errors.Is(err, ErrNotApproved) {
		t.Error("the sentinel must be preserved for the HTTP mapping")
	}
}
