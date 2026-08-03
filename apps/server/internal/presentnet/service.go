package presentnet

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	// ErrNotFound is a missing network or assignment.
	ErrNotFound = errors.New("presentation network was not found")
	// ErrNameTaken is a duplicate display name within the organization.
	ErrNameTaken = errors.New("a Presentation Network with that name already exists")
	// ErrScreenNotEligible means the screen cannot hold an assignment at all —
	// an Android player, or an archived screen. Assignment is a Linux-only
	// concept, and Studio must not offer a control that cannot work.
	ErrScreenNotEligible = errors.New("only Linux screens can be assigned a Presentation Network")
)

// ConfigBumper is the settings service's revision bump. Assignment changes have
// to reach the player through the ordinary configuration channel, and that
// channel is owned by internal/settings; this interface keeps presentnet from
// importing it and creating a cycle.
type ConfigBumper interface {
	BumpScreens(ctx context.Context, screens []uuid.UUID, reason string) error
}

// Service owns Presentation Network records and assignments.
type Service struct {
	db     *pgxpool.Pool
	cipher *Cipher
	bumper ConfigBumper
}

func NewService(db *pgxpool.Pool, cipher *Cipher) *Service {
	return &Service{db: db, cipher: cipher}
}

// SetConfigBumper wires the configuration channel after construction, matching
// how the rest of the server assembles services with mutual needs.
func (s *Service) SetConfigBumper(bumper ConfigBumper) { s.bumper = bumper }

// CredentialsAvailable reports whether this installation can seal and unseal
// credentials. Studio shows a clear operator explanation when it cannot, and
// creating or provisioning a credential is refused rather than half-done.
func (s *Service) CredentialsAvailable() bool { return s.cipher.Configured() }

func (s *Service) organization(ctx context.Context, q querier) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `SELECT id FROM organization_settings WHERE singleton`).Scan(&id)
	return id, err
}

// querier is the subset of pgx shared by the pool and a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

const networkColumns = `id,name,ssid,hidden,security,auth_metadata,
	secret_ciphertext IS NOT NULL,secret_updated_at,config_revision,created_at,updated_at`

func scanNetwork(row pgx.Row) (Network, error) {
	var network Network
	var metadata []byte
	err := row.Scan(&network.ID, &network.Name, &network.SSID, &network.Hidden,
		&network.Security, &metadata, &network.CredentialSet, &network.SecretUpdatedAt,
		&network.ConfigRevision, &network.CreatedAt, &network.UpdatedAt)
	if err != nil {
		return Network{}, err
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &network.Auth)
	}
	network.SecurityLabel = network.Security.Label()
	return network, nil
}

// List returns every network with the number of screens currently assigned to
// it. The count is what tells an administrator whether a delete is consequential.
func (s *Service) List(ctx context.Context) ([]Network, error) {
	rows, err := s.db.Query(ctx, `SELECT `+networkColumns+`,
		(SELECT count(*) FROM screen_presentation_networks a
		 JOIN screens sc ON sc.id=a.screen_id AND sc.archived_at IS NULL
		 WHERE a.presentation_network_id=presentation_networks.id)
		FROM presentation_networks ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	networks := []Network{}
	for rows.Next() {
		var network Network
		var metadata []byte
		if err := rows.Scan(&network.ID, &network.Name, &network.SSID, &network.Hidden,
			&network.Security, &metadata, &network.CredentialSet, &network.SecretUpdatedAt,
			&network.ConfigRevision, &network.CreatedAt, &network.UpdatedAt,
			&network.AssignedScreens); err != nil {
			return nil, err
		}
		if len(metadata) > 0 {
			_ = json.Unmarshal(metadata, &network.Auth)
		}
		network.SecurityLabel = network.Security.Label()
		networks = append(networks, network)
	}
	return networks, rows.Err()
}

// Get reads one network. It never returns the credential; CredentialSet is the
// only thing a read says about it.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (Network, error) {
	network, err := scanNetwork(s.db.QueryRow(ctx, `SELECT `+networkColumns+` FROM presentation_networks WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNotFound
	}
	if err != nil {
		return Network{}, err
	}
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM screen_presentation_networks a
		JOIN screens sc ON sc.id=a.screen_id AND sc.archived_at IS NULL
		WHERE a.presentation_network_id=$1`, id).Scan(&network.AssignedScreens); err != nil {
		return Network{}, err
	}
	return network, nil
}

// Create seals the credential and stores the network in one transaction, so a
// row can never exist with a credential the operator believes was saved but was
// not.
func (s *Service) Create(ctx context.Context, actor uuid.UUID, input Input) (Network, error) {
	validated, err := ValidateInput(input, false)
	if err != nil {
		return Network{}, err
	}
	if !s.cipher.Configured() {
		return Network{}, ErrKeyNotConfigured
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Network{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	organization, err := s.organization(ctx, tx)
	if err != nil {
		return Network{}, err
	}
	id := uuid.New()
	plaintext, err := encodeSecret(validated.Security, *validated.Secret)
	if err != nil {
		return Network{}, err
	}
	sealed, err := s.cipher.Seal(organization, id, plaintext)
	if err != nil {
		return Network{}, err
	}
	metadata, err := json.Marshal(validated.Auth)
	if err != nil {
		return Network{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO presentation_networks
		(id,organization_id,name,ssid,hidden,security,auth_metadata,secret_ciphertext,
		 secret_envelope_version,secret_updated_at,config_revision,created_by,updated_by)
		VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now(),1,$10,$10)`,
		id, organization, validated.Name, validated.SSID, validated.Hidden,
		string(validated.Security), string(metadata), sealed, EnvelopeVersion(), actorOrNil(actor)); err != nil {
		if isUniqueViolation(err) {
			return Network{}, ErrNameTaken
		}
		return Network{}, err
	}
	network, err := scanNetwork(tx.QueryRow(ctx, `SELECT `+networkColumns+` FROM presentation_networks WHERE id=$1`, id))
	if err != nil {
		return Network{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Network{}, err
	}
	return network, nil
}

// Update applies an edit. A nil Secret keeps the stored credential; a present one
// rotates it. Either way the configuration revision advances only when something
// a player has to act on actually changed, so an unrelated rename does not force
// every assigned display to re-provision.
func (s *Service) Update(ctx context.Context, actor, id uuid.UUID, input Input) (Network, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Network{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var organization uuid.UUID
	var current Network
	var metadata []byte
	var credentialStored bool
	err = tx.QueryRow(ctx, `SELECT organization_id,ssid,hidden,security,auth_metadata,
		secret_ciphertext IS NOT NULL,config_revision FROM presentation_networks WHERE id=$1 FOR UPDATE`, id).
		Scan(&organization, &current.SSID, &current.Hidden, &current.Security, &metadata,
			&credentialStored, &current.ConfigRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNotFound
	}
	if err != nil {
		return Network{}, err
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &current.Auth)
	}

	validated, err := ValidateInput(input, credentialStored)
	if err != nil {
		return Network{}, err
	}
	if validated.Secret != nil && !s.cipher.Configured() {
		return Network{}, ErrKeyNotConfigured
	}

	nextMetadata, err := json.Marshal(validated.Auth)
	if err != nil {
		return Network{}, err
	}
	// Only facts the player provisions from count as a material change. The
	// display name is Studio's label and never reaches a NetworkManager profile.
	material := validated.SSID != current.SSID ||
		validated.Hidden != current.Hidden ||
		validated.Security != current.Security ||
		string(nextMetadata) != normalizeJSON(metadata) ||
		validated.Secret != nil

	var sealed []byte
	envelopeVersion := 0
	if validated.Secret != nil {
		plaintext, encodeErr := encodeSecret(validated.Security, *validated.Secret)
		if encodeErr != nil {
			return Network{}, encodeErr
		}
		if sealed, err = s.cipher.Seal(organization, id, plaintext); err != nil {
			return Network{}, err
		}
		envelopeVersion = EnvelopeVersion()
	}
	if validated.Security != current.Security && validated.Secret == nil {
		// The stored envelope holds a PSK or a password, not both. Changing the
		// authentication type without supplying a new credential would leave the
		// player unable to build a profile, so it is refused up front rather than
		// failing later on a signage box.
		return Network{}, invalid("Changing the authentication type also needs a new credential for the new type.")
	}

	if _, err = tx.Exec(ctx, `UPDATE presentation_networks SET
		name=$2, ssid=$3, hidden=$4, security=$5, auth_metadata=$6::jsonb,
		secret_ciphertext=CASE WHEN $7 THEN $8 ELSE secret_ciphertext END,
		secret_envelope_version=CASE WHEN $7 THEN $9 ELSE secret_envelope_version END,
		secret_updated_at=CASE WHEN $7 THEN now() ELSE secret_updated_at END,
		config_revision=config_revision+CASE WHEN $10 THEN 1 ELSE 0 END,
		updated_by=$11, updated_at=now()
		WHERE id=$1`,
		id, validated.Name, validated.SSID, validated.Hidden, string(validated.Security),
		string(nextMetadata), validated.Secret != nil, sealed, nullableInt(envelopeVersion),
		material, actorOrNil(actor)); err != nil {
		if isUniqueViolation(err) {
			return Network{}, ErrNameTaken
		}
		return Network{}, err
	}
	network, err := scanNetwork(tx.QueryRow(ctx, `SELECT `+networkColumns+` FROM presentation_networks WHERE id=$1`, id))
	if err != nil {
		return Network{}, err
	}
	assigned, err := assignedScreenIDs(ctx, tx, id)
	if err != nil {
		return Network{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Network{}, err
	}
	network.AssignedScreens = len(assigned)
	if material {
		// Every assigned player has to learn the new revision. A player that is
		// offline picks it up from the durable configuration on its next sync
		// rather than needing a command that could expire.
		s.bump(ctx, assigned, "presentation_network.updated")
	}
	return network, nil
}

// Delete removes a network. Its assignments cascade, and every screen that held
// one gets a configuration bump so the player deletes the now-obsolete
// Tilecast-managed NetworkManager profile. A player that is offline performs the
// same cleanup when it next synchronizes, because the desired state — "no
// assignment" — is durable configuration rather than a command that expires.
func (s *Service) Delete(ctx context.Context, id uuid.UUID) (Network, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Network{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	network, err := scanNetwork(tx.QueryRow(ctx, `SELECT `+networkColumns+` FROM presentation_networks WHERE id=$1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Network{}, ErrNotFound
	}
	if err != nil {
		return Network{}, err
	}
	assigned, err := assignedScreenIDs(ctx, tx, id)
	if err != nil {
		return Network{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM presentation_networks WHERE id=$1`, id); err != nil {
		return Network{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Network{}, err
	}
	network.AssignedScreens = len(assigned)
	s.bump(ctx, assigned, "presentation_network.deleted")
	return network, nil
}

// Assignment is one screen's current network, with enough identity for Studio to
// render the row without a second request.
type Assignment struct {
	ScreenID    uuid.UUID  `json:"screenId"`
	ScreenName  string     `json:"screenName"`
	Platform    string     `json:"platform"`
	NetworkID   *uuid.UUID `json:"presentationNetworkId,omitempty"`
	NetworkName string     `json:"presentationNetworkName,omitempty"`
	AssignedAt  *time.Time `json:"assignedAt,omitempty"`
}

// AssignmentsFor lists the screens assigned to one network.
func (s *Service) AssignmentsFor(ctx context.Context, networkID uuid.UUID) ([]Assignment, error) {
	rows, err := s.db.Query(ctx, `SELECT sc.id,sc.name,sc.platform,a.presentation_network_id,n.name,a.assigned_at
		FROM screen_presentation_networks a
		JOIN screens sc ON sc.id=a.screen_id
		JOIN presentation_networks n ON n.id=a.presentation_network_id
		WHERE a.presentation_network_id=$1 AND sc.archived_at IS NULL
		ORDER BY lower(sc.name), sc.id`, networkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Assignment{}
	for rows.Next() {
		var item Assignment
		if err := rows.Scan(&item.ScreenID, &item.ScreenName, &item.Platform,
			&item.NetworkID, &item.NetworkName, &item.AssignedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// AssignmentForScreen reads one screen's assignment, returning a row with a nil
// network when there is none. "No Presentation Network assigned" is a real
// answer, not an error, and it is the answer that preserves existing AirPlay
// behavior.
func (s *Service) AssignmentForScreen(ctx context.Context, screenID uuid.UUID) (Assignment, error) {
	var item Assignment
	err := s.db.QueryRow(ctx, `SELECT sc.id,sc.name,sc.platform,a.presentation_network_id,
		COALESCE(n.name,''),a.assigned_at
		FROM screens sc
		LEFT JOIN screen_presentation_networks a ON a.screen_id=sc.id
		LEFT JOIN presentation_networks n ON n.id=a.presentation_network_id
		WHERE sc.id=$1 AND sc.archived_at IS NULL`, screenID).
		Scan(&item.ScreenID, &item.ScreenName, &item.Platform, &item.NetworkID, &item.NetworkName, &item.AssignedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Assignment{}, ErrNotFound
	}
	return item, err
}

// Assign points one screen at one network, replacing any previous assignment.
// Both the old and the new screen sets get a configuration bump, because the
// player that lost the assignment has an obsolete profile to delete.
func (s *Service) Assign(ctx context.Context, actor, screenID, networkID uuid.UUID) (Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Assignment{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var platform string
	if err = tx.QueryRow(ctx, `SELECT platform FROM screens WHERE id=$1 AND archived_at IS NULL`, screenID).Scan(&platform); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Assignment{}, ErrNotFound
		}
		return Assignment{}, err
	}
	if !strings.EqualFold(platform, "linux") {
		return Assignment{}, ErrScreenNotEligible
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM presentation_networks WHERE id=$1)`, networkID).Scan(&exists); err != nil {
		return Assignment{}, err
	}
	if !exists {
		return Assignment{}, ErrNotFound
	}
	if _, err = tx.Exec(ctx, `INSERT INTO screen_presentation_networks(screen_id,presentation_network_id,assigned_by)
		VALUES($1,$2,$3) ON CONFLICT(screen_id) DO UPDATE SET
			presentation_network_id=EXCLUDED.presentation_network_id,
			assigned_by=EXCLUDED.assigned_by, assigned_at=now()`,
		screenID, networkID, actorOrNil(actor)); err != nil {
		return Assignment{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Assignment{}, err
	}
	s.bump(ctx, []uuid.UUID{screenID}, "presentation_network.assigned")
	return s.AssignmentForScreen(ctx, screenID)
}

// Unassign clears one screen's assignment. The bump is what eventually removes
// the Tilecast-managed profile from that player.
func (s *Service) Unassign(ctx context.Context, screenID uuid.UUID) (Assignment, error) {
	tag, err := s.db.Exec(ctx, `DELETE FROM screen_presentation_networks WHERE screen_id=$1`, screenID)
	if err != nil {
		return Assignment{}, err
	}
	if tag.RowsAffected() > 0 {
		s.bump(ctx, []uuid.UUID{screenID}, "presentation_network.unassigned")
	}
	return s.AssignmentForScreen(ctx, screenID)
}

// ReplaceAssignments sets exactly which screens use one network. Screens that
// lose the assignment and screens that gain it are both bumped.
func (s *Service) ReplaceAssignments(ctx context.Context, actor, networkID uuid.UUID, screens []uuid.UUID) ([]Assignment, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM presentation_networks WHERE id=$1)`, networkID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	if len(screens) > 0 {
		var eligible int
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM screens WHERE id=ANY($1) AND archived_at IS NULL AND lower(platform)='linux'`, screens).Scan(&eligible); err != nil {
			return nil, err
		}
		if eligible != len(uniqueIDs(screens)) {
			return nil, ErrScreenNotEligible
		}
	}
	previous, err := assignedScreenIDs(ctx, tx, networkID)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM screen_presentation_networks
		WHERE presentation_network_id=$1 AND NOT (screen_id=ANY($2))`, networkID, uniqueIDs(screens)); err != nil {
		return nil, err
	}
	for _, screen := range uniqueIDs(screens) {
		if _, err = tx.Exec(ctx, `INSERT INTO screen_presentation_networks(screen_id,presentation_network_id,assigned_by)
			VALUES($1,$2,$3) ON CONFLICT(screen_id) DO UPDATE SET
				presentation_network_id=EXCLUDED.presentation_network_id,
				assigned_by=EXCLUDED.assigned_by, assigned_at=now()
			WHERE screen_presentation_networks.presentation_network_id<>EXCLUDED.presentation_network_id`,
			screen, networkID, actorOrNil(actor)); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	s.bump(ctx, mergeIDs(previous, screens), "presentation_network.assignments_replaced")
	return s.AssignmentsFor(ctx, networkID)
}

// ProvisioningMaterial is what an authorized, assigned player receives so it can
// build its NetworkManager profile. It is returned only over the authenticated
// player channel, only to the screen the network is actually assigned to, only
// with Cache-Control: no-store, and it is never written to a durable command
// payload, an audit record, or a log line.
type ProvisioningMaterial struct {
	NetworkID      uuid.UUID    `json:"presentationNetworkId"`
	Name           string       `json:"name"`
	SSID           string       `json:"ssid"`
	Hidden         bool         `json:"hidden"`
	Security       Security     `json:"security"`
	Auth           AuthMetadata `json:"auth"`
	ConfigRevision int64        `json:"configRevision"`
	ProfileName    string       `json:"profileName"`
	Secret         string       `json:"secret"`
}

// ProvisioningMaterialFor unseals the credential for exactly one screen.
//
// The authorization is the point of this method: it takes the screen the request
// authenticated as and joins through the assignment table, so a player can only
// ever obtain the network it has actually been assigned. There is no code path
// that accepts a network identifier from the player.
func (s *Service) ProvisioningMaterialFor(ctx context.Context, screenID uuid.UUID) (ProvisioningMaterial, error) {
	if !s.cipher.Configured() {
		return ProvisioningMaterial{}, ErrKeyNotConfigured
	}
	var (
		organization uuid.UUID
		material     ProvisioningMaterial
		metadata     []byte
		sealed       []byte
	)
	err := s.db.QueryRow(ctx, `SELECT n.organization_id,n.id,n.name,n.ssid,n.hidden,n.security,
		n.auth_metadata,n.config_revision,n.secret_ciphertext
		FROM screen_presentation_networks a
		JOIN presentation_networks n ON n.id=a.presentation_network_id
		JOIN screens sc ON sc.id=a.screen_id AND sc.archived_at IS NULL
		WHERE a.screen_id=$1`, screenID).
		Scan(&organization, &material.NetworkID, &material.Name, &material.SSID, &material.Hidden,
			&material.Security, &metadata, &material.ConfigRevision, &sealed)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProvisioningMaterial{}, ErrNotFound
	}
	if err != nil {
		return ProvisioningMaterial{}, err
	}
	if len(sealed) == 0 {
		return ProvisioningMaterial{}, ErrSecretUnreadable
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &material.Auth)
	}
	plaintext, err := s.cipher.Open(organization, material.NetworkID, sealed)
	if err != nil {
		return ProvisioningMaterial{}, err
	}
	secret, err := decodeSecret(material.Security, plaintext)
	if err != nil {
		return ProvisioningMaterial{}, err
	}
	material.Secret = secret
	material.ProfileName = ProfileName(material.NetworkID)
	return material, nil
}

// PlayerAssignment is the non-secret half a player receives through ordinary
// configuration synchronization. Everything a NetworkManager profile needs
// except the credential is here, so the player knows whether the profile it has
// installed is current without asking for the secret first.
type PlayerAssignment struct {
	NetworkID      uuid.UUID    `json:"presentationNetworkId"`
	Name           string       `json:"name"`
	SSID           string       `json:"ssid"`
	Hidden         bool         `json:"hidden"`
	Security       Security     `json:"security"`
	Auth           AuthMetadata `json:"auth"`
	ConfigRevision int64        `json:"configRevision"`
	ProfileName    string       `json:"profileName"`
	// CredentialAvailable is false when the server has no sealing key or the
	// stored envelope is empty. The player then reports a configuration error
	// instead of spending an AirPlay preparation window on a request that cannot
	// succeed.
	CredentialAvailable bool `json:"credentialAvailable"`
}

// PlayerConfiguration returns the assignment for one screen, or nil when it has
// none. A nil result is what preserves the existing Ethernet-only AirPlay path.
func (s *Service) PlayerConfiguration(ctx context.Context, screenID uuid.UUID) (*PlayerAssignment, error) {
	var (
		assignment PlayerAssignment
		metadata   []byte
		hasSecret  bool
	)
	err := s.db.QueryRow(ctx, `SELECT n.id,n.name,n.ssid,n.hidden,n.security,n.auth_metadata,
		n.config_revision,n.secret_ciphertext IS NOT NULL
		FROM screen_presentation_networks a
		JOIN presentation_networks n ON n.id=a.presentation_network_id
		WHERE a.screen_id=$1`, screenID).
		Scan(&assignment.NetworkID, &assignment.Name, &assignment.SSID, &assignment.Hidden,
			&assignment.Security, &metadata, &assignment.ConfigRevision, &hasSecret)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &assignment.Auth)
	}
	assignment.ProfileName = ProfileName(assignment.NetworkID)
	assignment.CredentialAvailable = hasSecret && s.cipher.Configured()
	return &assignment, nil
}

func assignedScreenIDs(ctx context.Context, q querier, networkID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT screen_id FROM screen_presentation_networks WHERE presentation_network_id=$1`, networkID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// bump is best effort on purpose. A configuration revision that fails to
// advance costs a delay until the next periodic reconcile; refusing the
// administrator's change because the notification failed would cost more.
func (s *Service) bump(ctx context.Context, screens []uuid.UUID, reason string) {
	if s.bumper == nil || len(screens) == 0 {
		return
	}
	_ = s.bumper.BumpScreens(ctx, uniqueIDs(screens), reason)
}

func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

func mergeIDs(left, right []uuid.UUID) []uuid.UUID {
	return uniqueIDs(append(append([]uuid.UUID(nil), left...), right...))
}

func actorOrNil(actor uuid.UUID) any {
	if actor == uuid.Nil {
		return nil
	}
	return actor
}

func nullableInt(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

// normalizeJSON re-marshals stored metadata so a whitespace or key-order
// difference in the column cannot look like a material change and force every
// assigned player to re-provision.
func normalizeJSON(raw []byte) string {
	if len(raw) == 0 {
		return "{}"
	}
	var metadata AuthMetadata
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return string(raw)
	}
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return string(raw)
	}
	return string(encoded)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// Describe renders a network for an audit record. It carries identity only:
// never the credential, never the ciphertext, never the CA material.
func Describe(network Network) map[string]any {
	return map[string]any{
		"presentationNetworkId": network.ID.String(),
		"name":                  network.Name,
		"ssid":                  network.SSID,
		"hidden":                network.Hidden,
		"security":              string(network.Security),
		"configRevision":        network.ConfigRevision,
		"assignedScreens":       network.AssignedScreens,
	}
}

// KeyUnavailable formats the operator-facing explanation with the caller's
// context, so a Studio message and a player-channel message read the same.
func KeyUnavailable(action string) string {
	return fmt.Sprintf("%s is unavailable. %s", action, KeyUnavailableMessage)
}
