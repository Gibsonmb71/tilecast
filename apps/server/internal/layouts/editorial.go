package layouts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/editorial"
	"github.com/tilecast/tilecast/apps/server/internal/manifestchanges"
)

func (s *Service) SnapshotTx(ctx context.Context, tx pgx.Tx, id uuid.UUID) (editorial.Snapshot, error) {
	var raw []byte
	var snapshot editorial.Snapshot
	var publishedRevision *int64
	err := tx.QueryRow(ctx, `SELECT l.draft_document,l.draft_revision,r.revision,l.published_revision_id FROM layouts l LEFT JOIN layout_revisions r ON r.id=l.published_revision_id WHERE l.id=$1 AND l.deleted_at IS NULL`, id).
		Scan(&raw, &snapshot.WorkingRevision, &publishedRevision, &snapshot.PublishedRevisionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return editorial.Snapshot{}, ErrNotFound
	}
	if err != nil {
		return editorial.Snapshot{}, err
	}
	snapshot.PublishedRevision = publishedRevision
	snapshot.Document = append([]byte(nil), raw...)
	sum := sha256.Sum256(raw)
	snapshot.Digest = hex.EncodeToString(sum[:])
	return snapshot, nil
}

func (s *Service) ValidateSnapshotTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, raw json.RawMessage) error {
	var document Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	if err := ValidateDocument(document); err != nil {
		return err
	}
	deps := Dependencies(document)
	if err := s.validateDependenciesTx(ctx, tx, deps); err != nil {
		return err
	}
	if err := s.validatePlaybackLimitsTx(ctx, tx, document); err != nil {
		return err
	}
	return s.validateStructuredBindingsTx(ctx, tx, document)
}

func (s *Service) PublishSnapshotTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, raw json.RawMessage, _ int64, userID uuid.UUID) (editorial.Published, error) {
	if err := s.ValidateSnapshotTx(ctx, tx, id, raw); err != nil {
		return editorial.Published{}, err
	}
	var document Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return editorial.Published{}, err
	}
	var current int64
	if err := tx.QueryRow(ctx, `SELECT draft_revision FROM layouts WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&current); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return editorial.Published{}, ErrNotFound
		}
		return editorial.Published{}, err
	}
	canonical, err := json.Marshal(document)
	if err != nil {
		return editorial.Published{}, err
	}
	sum := sha256.Sum256(canonical)
	digest := hex.EncodeToString(sum[:])
	var revision int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(revision),0)+1 FROM layout_revisions WHERE layout_id=$1`, id).Scan(&revision); err != nil {
		return editorial.Published{}, err
	}
	revisionID := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO layout_revisions(id,layout_id,revision,document,document_sha256,published_by)VALUES($1,$2,$3,$4,$5,$6)`, revisionID, id, revision, canonical, digest, userID); err != nil {
		return editorial.Published{}, err
	}
	for _, dep := range Dependencies(document) {
		if _, err = tx.Exec(ctx, `INSERT INTO layout_revision_dependencies(revision_id,dependency_type,dependency_id)VALUES($1,$2,$3)`, revisionID, dep.Type, dep.ID); err != nil {
			return editorial.Published{}, err
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE layouts SET published_revision_id=$1,updated_by=$2,updated_at=now() WHERE id=$3`, revisionID, userID, id); err != nil {
		return editorial.Published{}, err
	}
	var changes []manifestchanges.Change
	if transactional, ok := s.invalidator.(TransactionalManifestInvalidator); ok {
		changes, err = transactional.LayoutChangedInTx(ctx, tx, id, "layout.published")
		if err != nil {
			return editorial.Published{}, err
		}
	} else if s.invalidator != nil {
		// A non-transactional invalidator cannot safely be used for a workflow
		// publication. The production wiring always supplies the transactional
		// interface; fail closed for tests/integrations that do not.
		return editorial.Published{}, errors.New("layout publication invalidator is not transactional")
	}
	return editorial.Published{Revision: revision, RevisionID: &revisionID, Changes: changes, AffectedScreens: len(changes)}, nil
}

func (s *Service) RestoreDraftTx(ctx context.Context, tx pgx.Tx, id uuid.UUID, raw json.RawMessage, userID uuid.UUID) error {
	var document Document
	if err := json.Unmarshal(raw, &document); err != nil {
		return err
	}
	if err := s.ValidateSnapshotTx(ctx, tx, id, raw); err != nil {
		return err
	}
	deps := Dependencies(document)
	encoded, err := json.Marshal(document)
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `UPDATE layouts SET draft_document=$2,draft_revision=draft_revision+1,orientation=$3,canvas_width=$4,canvas_height=$5,updated_by=$6,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, id, encoded, document.Canvas.Orientation, document.Canvas.Width, document.Canvas.Height, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return s.replaceDraftDependencies(ctx, tx, id, deps)
}

func (s *Service) NotifyPublication(changes []manifestchanges.Change) {
	if transactional, ok := s.invalidator.(TransactionalManifestInvalidator); ok {
		transactional.NotifyManifestChanges(changes)
		return
	}
	for _, change := range changes {
		if s.notifier != nil {
			s.notifier.ManifestChanged(change.ScreenID, change.Version)
		}
	}
}
