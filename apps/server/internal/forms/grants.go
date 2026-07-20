package forms

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// GrantInput grants one capability to one user on one form.
type GrantInput struct {
	UserID     uuid.UUID
	Capability Capability
}

// ListGrants returns every per-form grant.
func (s *Service) ListGrants(ctx context.Context, id uuid.UUID) ([]Grant, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT g.id,g.user_id,COALESCE(u.name,''),g.capability
		FROM form_grants g LEFT JOIN users u ON u.id=g.user_id
		WHERE g.data_source_id=$1 ORDER BY u.name,g.capability`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grants := []Grant{}
	for rows.Next() {
		var grant Grant
		var capability string
		if err := rows.Scan(&grant.ID, &grant.UserID, &grant.UserName, &capability); err != nil {
			return nil, err
		}
		grant.Capability = Capability(capability)
		grants = append(grants, grant)
	}
	return grants, rows.Err()
}

// SetGrant adds a capability grant for a user (idempotent).
func (s *Service) SetGrant(ctx context.Context, id, actor uuid.UUID, in GrantInput) (Grant, error) {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return Grant{}, err
	}
	if !validCapabilities[in.Capability] {
		return Grant{}, fmt.Errorf("%w: unknown capability", ErrValidation)
	}
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)`, in.UserID).Scan(&exists); err != nil {
		return Grant{}, err
	}
	if !exists {
		return Grant{}, fmt.Errorf("%w: user does not exist", ErrValidation)
	}
	grantID := uuid.New()
	err := s.db.QueryRow(ctx, `INSERT INTO form_grants(id,data_source_id,user_id,capability,granted_by)
		VALUES($1,$2,$3,$4,$5)
		ON CONFLICT(data_source_id,user_id,capability) DO UPDATE SET granted_by=EXCLUDED.granted_by
		RETURNING id`, grantID, id, in.UserID, string(in.Capability), actor).Scan(&grantID)
	if err != nil {
		return Grant{}, err
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)
		VALUES($1,$2,'form.grant_set','data_source',$3,jsonb_build_object('user',$4::text,'capability',$5::text))`,
		uuid.New(), actor, id.String(), in.UserID.String(), string(in.Capability))
	return Grant{ID: grantID, UserID: in.UserID, UserName: s.userName(ctx, s.db, in.UserID), Capability: in.Capability}, nil
}

// RevokeGrant removes one grant by id.
func (s *Service) RevokeGrant(ctx context.Context, id, grantID, actor uuid.UUID) error {
	if _, err := s.ensureForm(ctx, s.db, id); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM form_grants WHERE id=$1 AND data_source_id=$2`, grantID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)
		VALUES($1,$2,'form.grant_revoked','data_source',$3)`, uuid.New(), actor, id.String())
	return nil
}
