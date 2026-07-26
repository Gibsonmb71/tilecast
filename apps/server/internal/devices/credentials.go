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
	var replaceExisting bool
	var approvedBy *uuid.UUID
	err = tx.QueryRow(ctx, `SELECT p.status,p.enrollment_token_hash,p.enrolled_at,p.resulting_screen_id,s.name,p.replace_existing_credential,p.approved_by_user_id FROM device_pairing_sessions p JOIN screens s ON s.id=p.resulting_screen_id WHERE p.id=$1 FOR UPDATE`, sessionID).Scan(&status, &expected, &enrolledAt, &screenID, &screenName, &replaceExisting, &approvedBy)
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
	credentialID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO device_credentials (id,screen_id,public_id,secret_hash) VALUES ($1,$2,$3,$4)`, credentialID, screenID, publicID, secretHash(secret)); err != nil {
		return EnrollmentResult{}, fmt.Errorf("create device credential: %w", err)
	}
	if replaceExisting {
		if _, err := tx.Exec(ctx, `UPDATE device_credentials SET revoked_at=now(),revocation_reason='Replaced through approved pairing recovery' WHERE screen_id=$1 AND id<>$2 AND revoked_at IS NULL`, screenID, credentialID); err != nil {
			return EnrollmentResult{}, fmt.Errorf("replace previous device credentials: %w", err)
		}
		if approvedBy != nil {
			if err := insertAudit(ctx, tx, *approvedBy, "screen.pairing.credential_replaced", screenID); err != nil {
				return EnrollmentResult{}, err
			}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE screens SET archived_at=NULL,archived_reason='',enabled=TRUE,paired_at=now(),updated_at=now() WHERE id=$1`, screenID); err != nil {
		return EnrollmentResult{}, fmt.Errorf("restore archived screen: %w", err)
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
	if len(heartbeat.PlayerVersion) > 120 {
		return errors.New("heartbeat metadata is invalid")
	}
	if len(heartbeat.CommissioningState) > 40 || len(heartbeat.CommissioningStep) > 80 || len(heartbeat.UpdateReadiness) > 40 || len(heartbeat.SelfTestResult) > 120 || heartbeat.BootAttemptCount != nil && (*heartbeat.BootAttemptCount < 0 || *heartbeat.BootAttemptCount > 1000) {
		return errors.New("heartbeat reliability metadata is invalid")
	}
	if len(heartbeat.PresentationSchemaVersions) > 8 || len(heartbeat.NativePresentationCapabilities) > 64 || heartbeat.WebRuntimeVersion < 0 || heartbeat.WebBundleLimitBytes < 0 {
		return errors.New("heartbeat presentation capabilities are invalid")
	}
	for capability, version := range heartbeat.NativePresentationCapabilities {
		if len(capability) < 1 || len(capability) > 80 || version < 1 || version > 100 {
			return errors.New("heartbeat presentation capabilities are invalid")
		}
	}
	ip := remoteAddress(address)
	// Liveness (last_heartbeat_at) must not depend on screen-dimension validity:
	// a player that reports 0x0 (some Linux display setups do) would otherwise be
	// frozen "online" with a stale last-contact. Keep the last-known dimensions
	// when the reported ones are out of range, but always record the heartbeat.
	_, err := s.db.Exec(ctx, `UPDATE screens SET screen_width=CASE WHEN $2 BETWEEN 1 AND 16384 THEN $2 ELSE screen_width END,screen_height=CASE WHEN $3 BETWEEN 1 AND 16384 THEN $3 ELSE screen_height END,available_storage_bytes=$4,uptime_seconds=$5,player_version=COALESCE(NULLIF($6,''),player_version),last_heartbeat_at=now(),last_known_ip=$7,updated_at=now() WHERE id=$1`, principal.ScreenID, heartbeat.ScreenWidth, heartbeat.ScreenHeight, heartbeat.AvailableStorageBytes, heartbeat.UptimeSeconds, heartbeat.PlayerVersion, addressString(ip))
	if err != nil {
		return fmt.Errorf("record heartbeat: %w", err)
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO screen_player_status(screen_id) VALUES($1) ON CONFLICT DO NOTHING`, principal.ScreenID)
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET player_version_code=$2,android_sdk=$3,installer_source=NULLIF($4,''),install_permission_status=NULLIF($5,''),current_update_deployment_id=$6,update_state=NULLIF($7,''),update_downloaded_bytes=$8,update_expected_bytes=$9,update_error=NULLIF($10,'') WHERE screen_id=$1`, principal.ScreenID, heartbeat.PlayerVersionCode, heartbeat.AndroidSDK, heartbeat.InstallerSource, heartbeat.InstallPermissionStatus, heartbeat.CurrentUpdateDeploymentID, heartbeat.UpdateState, heartbeat.UpdateDownloadedBytes, heartbeat.UpdateExpectedBytes, heartbeat.UpdateError)
	_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET presentation_schema_versions=$2,native_presentation_capabilities=$3,web_runtime_version=$4,web_bundle_limit_bytes=$5 WHERE screen_id=$1`, principal.ScreenID, heartbeat.PresentationSchemaVersions, heartbeat.NativePresentationCapabilities, heartbeat.WebRuntimeVersion, heartbeat.WebBundleLimitBytes)
	if heartbeat.ConfiguredReliabilityMode != "" || heartbeat.SafeMode != nil {
		var previousSafeMode bool
		var previousMaintenance, previousPINChange *time.Time
		_ = s.db.QueryRow(ctx, `SELECT safe_mode,maintenance_session_expires_at,admin_pin_changed_at FROM screen_player_status WHERE screen_id=$1`, principal.ScreenID).Scan(&previousSafeMode, &previousMaintenance, &previousPINChange)
		_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET configured_reliability_mode=NULLIF($2,''),effective_reliability_mode=NULLIF($3,''),foreground_state=NULLIF($4,''),last_foreground_exit_at=$5,last_foreground_package=NULLIF($6,''),boot_recovery_result=NULLIF($7,''),last_successful_cold_boot_at=$8,immersive_mode_active=$9,keep_screen_on=$10,managed_kiosk_capability=NULLIF($11,''),device_owner_state=NULLIF($12,''),lock_task_state=NULLIF($13,''),accessibility_service_state=NULLIF($14,''),accessibility_return_state=NULLIF($15,''),accessibility_return_attempts=$16,active_hours_state=NULLIF($17,''),sleep_capability=NULLIF($18,''),last_sleep_request_result=NULLIF($19,''),last_wake_result=NULLIF($20,''),recovery_level=$21,recovery_count=$22,safe_mode=COALESCE($23,safe_mode),last_watchdog_failure=NULLIF($24,''),last_watchdog_recovery_at=$25,maintenance_session_expires_at=$26 WHERE screen_id=$1`, principal.ScreenID, heartbeat.ConfiguredReliabilityMode, heartbeat.EffectiveReliabilityMode, heartbeat.ForegroundState, heartbeat.LastForegroundExitAt, heartbeat.LastForegroundPackage, heartbeat.BootRecoveryResult, heartbeat.LastSuccessfulColdBootAt, heartbeat.ImmersiveModeActive, heartbeat.KeepScreenOn, heartbeat.ManagedKioskCapability, heartbeat.DeviceOwnerState, heartbeat.LockTaskState, heartbeat.AccessibilityServiceState, heartbeat.AccessibilityReturnState, heartbeat.AccessibilityReturnAttempts, heartbeat.ActiveHoursState, heartbeat.SleepCapability, heartbeat.LastSleepRequestResult, heartbeat.LastWakeResult, heartbeat.RecoveryLevel, heartbeat.RecoveryCount, heartbeat.SafeMode, heartbeat.LastWatchdogFailure, heartbeat.LastWatchdogRecoveryAt, heartbeat.MaintenanceSessionExpiresAt)
		if heartbeat.AdminPINChangedAt != nil {
			_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET admin_pin_changed_at=$2 WHERE screen_id=$1 AND (admin_pin_changed_at IS NULL OR admin_pin_changed_at<$2)`, principal.ScreenID, heartbeat.AdminPINChangedAt)
		}
		_, _ = s.db.Exec(ctx, `UPDATE screen_player_status SET commissioning_state=NULLIF($2,''),commissioning_step=NULLIF($3,''),commissioning_completed_at=$4,cached_fallback_available=$5,last_healthy_playback_at=$6,last_playlist_transition_at=$7,last_successful_sync_at=$8,last_server_connection_at=$9,boot_attempt_count=$10,boot_last_attempt_at=$11,boot_launch_verified=$12,update_readiness=NULLIF($13,''),self_test_result=NULLIF($14,''),self_test_completed_at=$15 WHERE screen_id=$1`, principal.ScreenID, heartbeat.CommissioningState, heartbeat.CommissioningStep, heartbeat.CommissioningCompletedAt, heartbeat.CachedFallbackAvailable, heartbeat.LastHealthyPlaybackAt, heartbeat.LastPlaylistTransitionAt, heartbeat.LastSuccessfulSyncAt, heartbeat.LastServerConnectionAt, heartbeat.BootAttemptCount, heartbeat.BootLastAttemptAt, heartbeat.BootLaunchVerified, heartbeat.UpdateReadiness, heartbeat.SelfTestResult, heartbeat.SelfTestCompletedAt)
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
		if newSafeMode && heartbeat.CurrentUpdateDeploymentID != nil {
			_, _ = s.db.Exec(ctx, `UPDATE update_deployments d SET status='paused',rollout_phase='paused',paused_at=now(),pause_reason='A canary player entered safe mode.' WHERE d.id=$1 AND d.status='active' AND d.rollout_phase='canary' AND EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.screen_id=$2 AND st.is_canary)`, heartbeat.CurrentUpdateDeploymentID, principal.ScreenID)
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
	if heartbeat.PlayerVersionCode != nil && heartbeat.LastHealthyPlaybackAt != nil && (heartbeat.SafeMode == nil || !*heartbeat.SafeMode) {
		_, _ = s.db.Exec(ctx, `WITH completed AS (UPDATE screen_update_states SET state='succeeded',reconnect_at=now(),completed_at=now(),updated_at=now() WHERE screen_id=$1 AND expected_version_code<=$2 AND state IN('ready','waiting_for_permission','waiting_for_user','installing','reconnecting') AND (install_started_at IS NULL OR $3>install_started_at) RETURNING deployment_id) UPDATE update_deployments d SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.state NOT IN('succeeded','failed','cancelled','incompatible','already_current')) THEN 'completed' ELSE d.status END,completed_at=CASE WHEN NOT EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.state NOT IN('succeeded','failed','cancelled','incompatible','already_current')) THEN now() ELSE d.completed_at END WHERE d.id IN(SELECT deployment_id FROM completed)`, principal.ScreenID, *heartbeat.PlayerVersionCode, heartbeat.LastHealthyPlaybackAt)
	}
	return nil
}

// MarkHeartbeatContact records authenticated socket liveness without accepting
// optional status metadata. A malformed or newly introduced metadata field must
// not make an otherwise active player look silent.
func (s *Service) MarkHeartbeatContact(ctx context.Context, screenID uuid.UUID, address string) error {
	command, err := s.db.Exec(ctx, `UPDATE screens SET last_heartbeat_at=now(),last_known_ip=$2,updated_at=now() WHERE id=$1`, screenID, addressString(remoteAddress(address)))
	if err != nil {
		return fmt.Errorf("record heartbeat contact: %w", err)
	}
	if command.RowsAffected() != 1 {
		return errors.New("record heartbeat contact: screen was not found")
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
