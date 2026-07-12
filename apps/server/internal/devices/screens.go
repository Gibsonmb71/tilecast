package devices

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const screenSelect = `
SELECT s.id,s.name,s.description,s.location,s.platform,s.device_manufacturer,s.device_model,s.android_version,s.player_version,
       s.screen_width,s.screen_height,s.density,s.locale,s.timezone,s.available_storage_bytes,s.uptime_seconds,s.enabled,s.paired_at,
       s.last_connected_at,s.last_disconnected_at,s.last_heartbeat_at,s.last_known_ip::text,s.created_at,s.updated_at,
       EXISTS(SELECT 1 FROM device_credentials c WHERE c.screen_id=s.id AND c.revoked_at IS NULL),
       ps.player_version_code,ps.android_sdk,ps.installer_source,ps.install_permission_status,ps.current_update_deployment_id,ps.update_state,ps.update_downloaded_bytes,ps.update_expected_bytes,ps.update_error
FROM screens s LEFT JOIN screen_player_status ps ON ps.screen_id=s.id`

func (s *Service) ListScreens(ctx context.Context) ([]Screen, error) {
	rows, err := s.db.Query(ctx, screenSelect+` ORDER BY s.name ASC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("list screens: %w", err)
	}
	defer rows.Close()
	result := make([]Screen, 0)
	for rows.Next() {
		screen, err := scanScreen(rows, s.presence, s.now())
		if err != nil {
			return nil, err
		}
		result = append(result, screen)
	}
	return result, rows.Err()
}

func (s *Service) GetScreen(ctx context.Context, id uuid.UUID) (Screen, error) {
	row := s.db.QueryRow(ctx, screenSelect+` WHERE s.id=$1`, id)
	screen, err := scanScreen(row, s.presence, s.now())
	if errors.Is(err, pgx.ErrNoRows) {
		return Screen{}, ErrNotFound
	}
	return screen, err
}

type scanner interface {
	Scan(...any) error
}

func scanScreen(row scanner, presence *PresenceHub, now time.Time) (Screen, error) {
	var screen Screen
	if err := row.Scan(&screen.ID, &screen.Name, &screen.Description, &screen.Location, &screen.Platform, &screen.DeviceManufacturer, &screen.DeviceModel, &screen.AndroidVersion, &screen.PlayerVersion, &screen.ScreenWidth, &screen.ScreenHeight, &screen.Density, &screen.Locale, &screen.Timezone, &screen.AvailableStorageBytes, &screen.UptimeSeconds, &screen.Enabled, &screen.PairedAt, &screen.LastConnectedAt, &screen.LastDisconnectedAt, &screen.LastHeartbeatAt, &screen.LastKnownIP, &screen.CreatedAt, &screen.UpdatedAt, &screen.HasActiveCredential, &screen.PlayerVersionCode, &screen.AndroidSDK, &screen.InstallerSource, &screen.InstallPermissionStatus, &screen.CurrentUpdateDeploymentID, &screen.UpdateState, &screen.UpdateDownloadedBytes, &screen.UpdateExpectedBytes, &screen.UpdateError); err != nil {
		return Screen{}, err
	}
	screen.LastContactAt = latestContact(screen.LastConnectedAt, screen.LastDisconnectedAt, screen.LastHeartbeatAt)
	screen.Status = ComputeStatus(now, presence.Connected(screen.ID), screen.Enabled, screen.HasActiveCredential, screen.LastContactAt)
	return screen, nil
}

func (s *Service) UpdateScreen(ctx context.Context, id, userID uuid.UUID, name, location, description string) (Screen, error) {
	name, location, description = strings.TrimSpace(name), strings.TrimSpace(location), strings.TrimSpace(description)
	if len(name) < 2 || len(name) > 120 || len(location) > 240 || len(description) > 1000 {
		return Screen{}, errors.New("screen details are invalid")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Screen{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	result, err := tx.Exec(ctx, `UPDATE screens SET name=$2,location=$3,description=$4,updated_at=now() WHERE id=$1`, id, name, location, description)
	if err != nil {
		return Screen{}, fmt.Errorf("update screen: %w", err)
	}
	if result.RowsAffected() != 1 {
		return Screen{}, ErrNotFound
	}
	if err := insertAudit(ctx, tx, userID, "screen.updated", id); err != nil {
		return Screen{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Screen{}, err
	}
	return s.GetScreen(ctx, id)
}

func (s *Service) SetEnabled(ctx context.Context, id, userID uuid.UUID, enabled bool) error {
	action := "screen.disabled"
	if enabled {
		action = "screen.enabled"
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	result, err := tx.Exec(ctx, `UPDATE screens SET enabled=$2,updated_at=now() WHERE id=$1`, id, enabled)
	if err != nil {
		return fmt.Errorf("change screen state: %w", err)
	}
	if result.RowsAffected() != 1 {
		return ErrNotFound
	}
	if err := insertAudit(ctx, tx, userID, action, id); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if !enabled {
		s.presence.Disconnect(id)
	}
	return nil
}

func (s *Service) Revoke(ctx context.Context, id, userID uuid.UUID, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "Revoked by administrator"
	}
	if len(reason) > 500 {
		return errors.New("revocation reason is too long")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	result, err := tx.Exec(ctx, `UPDATE device_credentials SET revoked_at=now(),revocation_reason=$2 WHERE screen_id=$1 AND revoked_at IS NULL`, id, reason)
	if err != nil {
		return fmt.Errorf("revoke device credential: %w", err)
	}
	if result.RowsAffected() == 0 {
		return ErrConflict
	}
	if _, err := tx.Exec(ctx, `UPDATE screens SET updated_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	if err := insertAudit(ctx, tx, userID, "screen.credential.revoked", id); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.presence.Disconnect(id)
	return nil
}
