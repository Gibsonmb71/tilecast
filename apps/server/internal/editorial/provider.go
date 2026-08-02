// Package editorial contains the small contracts shared by the editorial
// workflow and concrete content services.  Keeping the contracts here avoids
// making playlists and layouts depend on the review implementation while still
// letting one transaction publish either kind of content.
package editorial

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/manifestchanges"
)

// Snapshot is the immutable document captured when Submit for review is
// pressed.  PublishedRevision is the native runtime revision on which the
// draft was based; it is informational for a provider that has not published
// anything yet.
type Snapshot struct {
	WorkingRevision     int64
	PublishedRevision   *int64
	PublishedRevisionID *uuid.UUID
	Document            json.RawMessage
	Digest              string
}

// Published describes the native revision created by a publication and the
// manifest invalidations that were committed with it. Notifications are sent
// only after the caller commits.
type Published struct {
	Revision        int64
	RevisionID      *uuid.UUID
	Changes         []manifestchanges.Change
	AffectedScreens int
}

// Provider is implemented by a concrete content service. Every mutating
// method receives the caller's transaction so a submission, its publication
// history, the runtime rows, and manifest state commit as one unit.
type Provider interface {
	SnapshotTx(context.Context, pgx.Tx, uuid.UUID) (Snapshot, error)
	ValidateSnapshotTx(context.Context, pgx.Tx, uuid.UUID, json.RawMessage) error
	PublishSnapshotTx(context.Context, pgx.Tx, uuid.UUID, json.RawMessage, int64, uuid.UUID) (Published, error)
	RestoreDraftTx(context.Context, pgx.Tx, uuid.UUID, json.RawMessage, uuid.UUID) error
	NotifyPublication([]manifestchanges.Change)
}
