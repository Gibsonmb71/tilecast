package devices

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) Enroll(ctx context.Context, sessionID uuid.UUID, enrollmentToken string) (EnrollmentResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return EnrollmentResult{}, fmt.Errorf("begin enrollment: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var status string
	var expected []byte
	var enrolledAt *time.Time
	var screenID uuid.UUID
	var screenName string
	err = tx.QueryRow(ctx, `SELECT p.status,p.enrollment_token_hash,p.enrolled_at,p.resulting_screen_id,s.name FROM device_pairing_sessions p JOIN screens s ON s.id=p.resulting_screen_id WHERE p.id=$1 FOR UPDATE`, sessionID).Scan(&status, &expected, &enrolledAt, &screenID, &screenName)
	if errors.Is(err, pgx.ErrNoRows) {
		return EnrollmentResult{}, ErrNotFound
	}
	if err != nil {
		return EnrollmentResult{}, fmt.Errorf("read enrollment: %w", err)
	}
	if status != "claimed" || enrolledAt != nil || len(expected) == 0 {
		return EnrollmentResult{}, ErrAlreadyClaimed
	}
	if !secretMatches(expected, enrollmentToken) {
		return EnrollmentResult{}, ErrWrongSecret
	}
	publicID, secret, credential, err := newDeviceCredential()
	if err != nil {
		return EnrollmentResult{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO device_credentials (id,screen_id,public_id,secret_hash) VALUES ($1,$2,$3,$4)`, uuid.New(), screenID, publicID, secretHash(secret)); err != nil {
		return EnrollmentResult{}, fmt.Errorf("create device credential: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE device_pairing_sessions SET enrolled_at=now(),enrollment_token_hash=NULL WHERE id=$1`, sessionID); err != nil {
		return EnrollmentResult{}, fmt.Errorf("complete enrollment: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return EnrollmentResult{}, fmt.Errorf("commit enrollment: %w", err)
	}
	return EnrollmentResult{ScreenID: screenID, ScreenName: screenName, DeviceCredential: credential}, nil
}

func (s *Service) AuthenticateDevice(ctx context.Context, credential string) (DevicePrincipal, error) {
	publicID, secret, err := ParseDeviceCredential(credential)
	if err != nil {
		return DevicePrincipal{}, ErrInvalidCredential
	}
	var principal DevicePrincipal
	var expected []byte
	var revokedAt *time.Time
	err = s.db.QueryRow(ctx, `SELECT c.id,c.screen_id,c.secret_hash,c.revoked_at,s.name,s.enabled FROM device_credentials c JOIN screens s ON s.id=c.screen_id WHERE c.public_id=$1`, publicID).Scan(
		&principal.CredentialID, &principal.ScreenID, &expected, &revokedAt, &principal.ScreenName, &principal.Enabled,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return DevicePrincipal{}, ErrInvalidCredential
	}
	if err != nil {
		return DevicePrincipal{}, fmt.Errorf("read device credential: %w", err)
	}
	if !secretMatches(expected, secret) {
		return DevicePrincipal{}, ErrInvalidCredential
	}
	if revokedAt != nil {
		return DevicePrincipal{}, ErrRevokedCredential
	}
	if !principal.Enabled {
		return DevicePrincipal{}, ErrDisabledScreen
	}
	_, _ = s.db.Exec(ctx, `UPDATE device_credentials SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')`, principal.CredentialID)
	return principal, nil
}

func (s *Service) Heartbeat(ctx context.Context, principal DevicePrincipal, heartbeat Heartbeat, address string) error {
	if heartbeat.ScreenWidth < 1 || heartbeat.ScreenWidth > 16384 || heartbeat.ScreenHeight < 1 || heartbeat.ScreenHeight > 16384 || len(heartbeat.PlayerVersion) > 120 {
		return errors.New("heartbeat metadata is invalid")
	}
	ip := remoteAddress(address)
	_, err := s.db.Exec(ctx, `UPDATE screens SET screen_width=$2,screen_height=$3,available_storage_bytes=$4,uptime_seconds=$5,player_version=COALESCE(NULLIF($6,''),player_version),last_heartbeat_at=now(),last_known_ip=$7,updated_at=now() WHERE id=$1`, principal.ScreenID, heartbeat.ScreenWidth, heartbeat.ScreenHeight, heartbeat.AvailableStorageBytes, heartbeat.UptimeSeconds, heartbeat.PlayerVersion, addressString(ip))
	if err != nil {
		return fmt.Errorf("record heartbeat: %w", err)
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO screen_player_status(screen_id) VALUES($1) ON CONFLICT DO NOTHING`, principal.ScreenID)
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET player_version_code=$2,android_sdk=$3,installer_source=NULLIF($4,''),install_permission_status=NULLIF($5,''),current_update_deployment_id=$6,update_state=NULLIF($7,''),update_downloaded_bytes=$8,update_expected_bytes=$9,update_error=NULLIF($10,'') WHERE screen_id=$1`, principal.ScreenID, heartbeat.PlayerVersionCode, heartbeat.AndroidSDK, heartbeat.InstallerSource, heartbeat.InstallPermissionStatus, heartbeat.CurrentUpdateDeploymentID, heartbeat.UpdateState, heartbeat.UpdateDownloadedBytes, heartbeat.UpdateExpectedBytes, heartbeat.UpdateError)
	if heartbeat.ConfiguredReliabilityMode != "" || heartbeat.SafeMode != nil {
		var previousSafeMode bool
		var previousMaintenance, previousPINChange *time.Time
		_ = s.db.QueryRow(ctx, `SELECT safe_mode,maintenance_session_expires_at,admin_pin_changed_at FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&previousSafeMode, &previousMaintenance, &previousPINChange)
		_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET configured_reliability_mode=NULLIF($2,''),effective_reliability_mode=NULLIF($3,''),foreground_state=NULLIF($4,''),last_foreground_exit_at=$5,last_foreground_package=NULLIF($6,''),boot_recovery_result=NULLIF($7,''),last_successful_cold_boot_at=$8,immersive_mode_active=$9,keep_screen_on=$10,managed_kiosk_capability=NULLIF($11,''),device_owner_state=NULLIF($12,''),lock_task_state=NULLIF($13,''),accessibility_service_state=NULLIF($14,''),accessibility_return_state=NULLIF($15,''),accessibility_return_attempts=$16,active_hours_state=NULLIF($17,''),sleep_capability=NULLIF($18,''),last_sleep_request_result=NULLIF($19,''),last_wake_result=NULLIF($20,''),recovery_level=$21,recovery_count=$22,safe_mode=COALESCE($23,safe_mode),last_watchdog_failure=NULLIF($24,''),last_watchdog_recovery_at=$25,maintenance_session_expires_at=$26 WHERE screen_id=$1`, principal.ScreenID, heartbeat.ConfiguredReliabilityMode, heartbeat.EffectiveReliabilityMode, heartbeat.ForegroundState, heartbeat.LastForegroundExitAt, heartbeat.LastForegroundPackage, heartbeat.BootRecoveryResult, heartbeat.LastSuccessfulColdBootAt, heartbeat.ImmersiveModeActive, heartbeat.KeepScreenOn, heartbeat.ManagedKioskCapability, heartbeat.DeviceOwnerState, heartbeat.LockTaskState, heartbeat.AccessibilityServiceState, heartbeat.AccessibilityReturnState, heartbeat.AccessibilityReturnAttempts, heartbeat.ActiveHoursState, heartbeat.SleepCapability, heartbeat.LastSleepRequestResult, heartbeat.LastWakeResult, heartbeat.RecoveryLevel, heartbeat.RecoveryCount, heartbeat.SafeMode, heartbeat.LastWatchdogFailure, heartbeat.LastWatchdogRecoveryAt, heartbeat.MaintenanceSessionExpiresAt)
		if heartbeat.AdminPINChangedAt != nil {
			_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET admin_pin_changed_at=$2 WHERE screen_id=$1 AND (admin_pin_changed_at IS NULL OR admin_pin_changed_at<$2)`, principal.ScreenID, heartbeat.AdminPINChangedAt)
		}
		now := time.Now()
		newSafeMode := previousSafeMode
		if heartbeat.SafeMode != nil {
			newSafeMode = *heartbeat.SafeMode
		}
		previousMaintenanceActive := previousMaintenance != nil && previousMaintenance.After(now)
		newMaintenanceActive := heartbeat.MaintenanceSessionExpiresAt != nil && heartbeat.MaintenanceSessionExpiresAt.After(now)
		audit := func(action string) {
			_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,action,resource_type,resource_id)VALUES($1,$2,'screen',$3)`, uuid.New(), action, principal.ScreenID.String())
		}
		if newSafeMode != previousSafeMode {
			if newSafeMode {
				audit("reliability.safe_mode_entered")
			} else {
				audit("reliability.safe_mode_exited")
			}
		}
		if newMaintenanceActive != previousMaintenanceActive {
			if newMaintenanceActive {
				audit("reliability.maintenance_started")
			} else {
				audit("reliability.maintenance_ended")
			}
		}
		if heartbeat.AdminPINChangedAt != nil && (previousPINChange == nil || heartbeat.AdminPINChangedAt.After(*previousPINChange)) {
			audit("reliability.admin_pin_changed")
		}
	}
	if heartbeat.PlayerVersionCode != nil {
		_, _ = s.db.Exec(ctx, `WITH completed AS (UPDATE screen_update_states SET state='succeeded',reconnect_at=now(),completed_at=now(),updated_at=now() WHERE screen_id=$1 AND expected_version_code<=$2 AND state IN('ready','waiting_for_permission','waiting_for_user','installing','reconnecting') RETURNING deployment_id) UPDATE update_deployments d SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.state NOT IN('succeeded','failed','cancelled','incompatible','already_current')) THEN 'completed' ELSE d.status END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.state NOT IN('succeeded','failed','cancelled','incompatible','already_current')) THEN now() ELSE d.completed_at END WHERE d.id IN(SELECT deployment_id FROM completed)`, principal.ScreenID, *heartbeat.PlayerVersionCode)
	}
	return nil
}

func (s *Service) MarkConnected(ctx context.Context, screenID uuid.UUID, address string) error {
	_, err := s.db.Exec(ctx, `UPDATE screens SET last_connected_at=now(),last_known_ip=$2,updated_at=now() WHERE id=$1`, screenID, addressString(remoteAddress(address)))
	return err
}

func (s *Service) MarkDisconnected(ctx context.Context, screenID uuid.UUID) {
	_, _ = s.db.Exec(ctx, `UPDATE screens SET last_disconnected_at=now(),updated_at=now() WHERE id=$1`, screenID)
}

func (s *Service) RegisterPresence(screenID uuid.UUID, closeConnection func()) func() {
	return s.presence.Connect(screenID, closeConnection)
}
