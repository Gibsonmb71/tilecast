package forms

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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

// SearchUsers returns a bounded, manager-safe directory of active users for granting form access. It
// exposes only id, name, username, and global role — never credentials, activity, or timestamps —
// and is authorized per-form (a form manager), not via the Owner/Admin-only user administration API.
func (s *Service) SearchUsers(ctx context.Context, query string, limit int) ([]DirectoryUser, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query = strings.TrimSpace(query)
	rows, err := s.db.Query(ctx, `SELECT id,name,username,role FROM users
		WHERE active=TRUE AND ($1='' OR name ILIKE '%'||$1||'%' OR username ILIKE '%'||$1||'%')
		ORDER BY lower(name),id LIMIT $2`, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []DirectoryUser{}
	for rows.Next() {
		var user DirectoryUser
		if err := rows.Scan(&user.ID, &user.Name, &user.Username, &user.Role); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

// collapseCapabilities reduces a requested capability set to its minimal generating set by dropping
// implied capabilities (manage implies everything; approve⇒review⇒view_all⇒view_own; submit is
// independent), so redundant implied grants are never stored or shown separately.
func collapseCapabilities(caps []Capability) []Capability {
	set := map[Capability]bool{}
	for _, capability := range caps {
		if validCapabilities[capability] {
			set[capability] = true
		}
	}
	if set[CapManage] {
		return []Capability{CapManage}
	}
	result := []Capability{}
	switch {
	case set[CapApprove]:
		result = append(result, CapApprove)
	case set[CapReview]:
		result = append(result, CapReview)
	case set[CapViewAll]:
		result = append(result, CapViewAll)
	case set[CapViewOwn]:
		result = append(result, CapViewOwn)
	}
	if set[CapSubmit] {
		result = append(result, CapSubmit)
	}
	return result
}

func containsCap(caps []Capability, want Capability) bool {
	for _, capability := range caps {
		if capability == want {
			return true
		}
	}
	return false
}

// ReplaceGrants atomically replaces one user's grants on a form with the collapsed capability set,
// auditing the change in the same transaction (all-or-nothing). The form creator is always an
// implicit manager and cannot have grants edited here. A user cannot remove their own only path to
// managing the form (unless they retain it as the creator or a global Owner).
func (s *Service) ReplaceGrants(ctx context.Context, id, actor, targetUser uuid.UUID, caps []Capability) ([]AccessEntry, error) {
	createdBy, err := s.ensureForm(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if createdBy != nil && *createdBy == targetUser {
		return nil, fmt.Errorf("%w: the form creator is always a manager and cannot be changed here", ErrValidation)
	}
	for _, capability := range caps {
		if !validCapabilities[capability] {
			return nil, fmt.Errorf("%w: unknown capability %q", ErrValidation, capability)
		}
	}
	collapsed := collapseCapabilities(caps)

	// Guard against a manager removing their own last management path.
	if targetUser == actor && !containsCap(collapsed, CapManage) {
		isCreator := createdBy != nil && *createdBy == actor
		role, roleErr := s.userGlobalRole(ctx, s.db, actor)
		if roleErr != nil {
			return nil, roleErr
		}
		if !isCreator && role != "owner" {
			return nil, fmt.Errorf("%w: you cannot remove your own management access to this form", ErrValidation)
		}
	}

	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)`, targetUser).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("%w: user does not exist", ErrValidation)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `DELETE FROM form_grants WHERE data_source_id=$1 AND user_id=$2`, id, targetUser); err != nil {
		return nil, err
	}
	for _, capability := range collapsed {
		if _, err := tx.Exec(ctx, `INSERT INTO form_grants(id,data_source_id,user_id,capability,granted_by)
			VALUES($1,$2,$3,$4,$5)`, uuid.New(), id, targetUser, string(capability), actor); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)
		VALUES($1,$2,'form.grants_replaced','data_source',$3,jsonb_build_object('user',$4::text,'capabilities',$5::text))`,
		uuid.New(), actor, id.String(), targetUser.String(), strings.Join(capabilityStrings(collapsed), ",")); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.ListAccess(ctx, id)
}

func capabilityStrings(caps []Capability) []string {
	out := make([]string, 0, len(caps))
	for _, capability := range caps {
		out = append(out, string(capability))
	}
	return out
}

// ListAccess returns one row per user with effective access to the form: the creator as an implicit
// manager, followed by every granted user with their collapsed capability set.
func (s *Service) ListAccess(ctx context.Context, id uuid.UUID) ([]AccessEntry, error) {
	createdBy, err := s.ensureForm(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	entries := []AccessEntry{}
	seen := map[uuid.UUID]bool{}
	if createdBy != nil {
		var entry AccessEntry
		entry.UserID = *createdBy
		if err := s.db.QueryRow(ctx, `SELECT COALESCE(name,''),COALESCE(username,''),COALESCE(role,'') FROM users WHERE id=$1`, *createdBy).
			Scan(&entry.Name, &entry.Username, &entry.Role); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		entry.Capabilities = []Capability{CapManage}
		entry.IsCreator = true
		entries = append(entries, entry)
		seen[*createdBy] = true
	}
	rows, err := s.db.Query(ctx, `SELECT g.user_id,COALESCE(u.name,''),COALESCE(u.username,''),COALESCE(u.role,''),g.capability
		FROM form_grants g LEFT JOIN users u ON u.id=g.user_id
		WHERE g.data_source_id=$1 ORDER BY u.name,g.user_id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byUser := map[uuid.UUID]*AccessEntry{}
	order := []uuid.UUID{}
	for rows.Next() {
		var userID uuid.UUID
		var name, username, role, capability string
		if err := rows.Scan(&userID, &name, &username, &role, &capability); err != nil {
			return nil, err
		}
		if seen[userID] {
			continue // the creator's implicit manager row already covers them
		}
		entry, ok := byUser[userID]
		if !ok {
			entry = &AccessEntry{UserID: userID, Name: name, Username: username, Role: role, Capabilities: []Capability{}}
			byUser[userID] = entry
			order = append(order, userID)
		}
		entry.Capabilities = append(entry.Capabilities, Capability(capability))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, userID := range order {
		entry := byUser[userID]
		entry.Capabilities = collapseCapabilities(entry.Capabilities)
		entries = append(entries, *entry)
	}
	return entries, nil
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
