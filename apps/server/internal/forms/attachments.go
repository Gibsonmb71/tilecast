package forms

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AttachAsset links an uploaded image to a record and reclassifies it as a form attachment so it
// never appears in the public Media library or a manifest until its record is approved and
// projected. The asset must be an image; other types are rejected.
func (s *Service) AttachAsset(ctx context.Context, recordID, assetID, actor uuid.UUID, fieldKey string) (Attachment, error) {
	var formID uuid.UUID
	if err := s.db.QueryRow(ctx, `SELECT data_source_id FROM form_records WHERE id=$1 AND deleted_at IS NULL`, recordID).Scan(&formID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Attachment{}, ErrNotFound
		}
		return Attachment{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Attachment{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var assetType string
	err = tx.QueryRow(ctx, `SELECT type FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, assetID).Scan(&assetType)
	if errors.Is(err, pgx.ErrNoRows) {
		return Attachment{}, fmt.Errorf("%w: attachment asset does not exist", ErrValidation)
	}
	if err != nil {
		return Attachment{}, err
	}
	if assetType != "image" {
		return Attachment{}, fmt.Errorf("%w: only image attachments are permitted", ErrValidation)
	}
	if _, err := tx.Exec(ctx, `UPDATE assets SET origin='form_attachment',updated_at=now() WHERE id=$1`, assetID); err != nil {
		return Attachment{}, err
	}
	attachmentID := uuid.New()
	err = tx.QueryRow(ctx, `INSERT INTO form_record_attachments(id,record_id,asset_id,field_key)
		VALUES($1,$2,$3,$4)
		ON CONFLICT(record_id,asset_id) DO UPDATE SET field_key=EXCLUDED.field_key
		RETURNING id`, attachmentID, recordID, assetID, fieldKey).Scan(&attachmentID)
	if err != nil {
		return Attachment{}, err
	}
	actorName := s.userName(ctx, tx, actor)
	if err := insertEvent(ctx, tx, recordID, formID, "attachment_added", "", "", actor, actorName, ""); err != nil {
		return Attachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Attachment{}, err
	}
	return Attachment{ID: attachmentID, AssetID: assetID, FieldKey: fieldKey}, nil
}
