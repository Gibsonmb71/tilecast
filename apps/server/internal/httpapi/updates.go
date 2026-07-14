package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

func (s *server) listPlayerReleases(w http.ResponseWriter, r *http.Request) {
	var releaseCount int
	var checked *time.Time
	var providerError *string
	_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM player_releases`).Scan(&releaseCount)
	_ = s.db.QueryRow(r.Context(), `SELECT last_checked_at,safe_error FROM update_provider_state WHERE provider='github'`).Scan(&checked, &providerError)
	if releaseCount == 0 || checked == nil || time.Since(*checked) > 15*time.Minute {
		ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
		_ = s.updates.Check(ctx)
		cancel()
		checked = nil
		providerError = nil
		_ = s.db.QueryRow(r.Context(), `SELECT last_checked_at,safe_error FROM update_provider_state WHERE provider='github'`).Scan(&checked, &providerError)
	}

	rows, err := s.db.Query(r.Context(), `SELECT id,COALESCE(github_tag,''),source,channel,version_code,version_name,minimum_sdk,release_notes,published_at,apk_size,apk_sha256,signing_certificate_sha256,manifest_signature,cache_status,verification_status,verification_error FROM player_releases ORDER BY version_code DESC`)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var tag, source, channel, name, notes, hash, cert, signature, cache, verification string
		var code, size int64
		var sdk int
		var published time.Time
		var verificationError *string
		if rows.Scan(&id, &tag, &source, &channel, &code, &name, &sdk, &notes, &published, &size, &hash, &cert, &signature, &cache, &verification, &verificationError) == nil {
			items = append(items, map[string]any{"id": id, "tag": tag, "source": source, "channel": channel, "versionCode": code, "versionName": name, "minimumSdk": sdk, "releaseNotes": notes, "publishedAt": published, "apkSizeBytes": size, "apkSha256": hash, "signingCertificateSha256": cert, "manifestSignature": signature, "cacheStatus": cache, "verificationStatus": verification, "verificationError": verificationError})
		}
	}
	writeJSON(w, 200, map[string]any{"data": map[string]any{"repository": "Gibsonmb71/tilecast", "lastCheckedAt": checked, "providerError": providerError, "manifestKeyConfigured": s.updates.ManifestKeyConfigured(), "items": items}})
}

func (s *server) uploadPlayerRelease(w http.ResponseWriter, r *http.Request) {
	if !s.updates.ManifestKeyConfigured() {
		writeError(w, http.StatusServiceUnavailable, "update_manifest_key_missing", "A trusted update manifest public key must be configured before importing releases.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.updates.MaximumUploadBytes())
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "player_release_upload_invalid", "Upload a multipart form containing the three required release files.")
		return
	}
	temporary, err := os.MkdirTemp("", "tilecast-player-release-*")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer os.RemoveAll(temporary)

	files := map[string]string{}
	for {
		part, partErr := reader.NextPart()
		if errors.Is(partErr, io.EOF) {
			break
		}
		if partErr != nil {
			writeError(w, http.StatusBadRequest, "player_release_upload_invalid", "The release upload could not be read.")
			return
		}
		name := filepath.Base(part.FileName())
		limit, accepted := releaseUploadPartLimit(name, part.Header.Get("Content-Type"), s.updates.MaximumAPKBytes())
		if !accepted || name != part.FileName() || files[name] != "" {
			part.Close()
			writeError(w, http.StatusUnprocessableEntity, "player_release_file_invalid", "Only one copy of each required Tilecast Player release file is accepted.")
			return
		}
		path := filepath.Join(temporary, name)
		file, createErr := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if createErr != nil {
			part.Close()
			s.internalError(w, r, createErr)
			return
		}
		written, copyErr := io.Copy(file, io.LimitReader(part, limit+1))
		closeErr := file.Close()
		part.Close()
		if copyErr != nil || closeErr != nil || written > limit {
			writeError(w, http.StatusRequestEntityTooLarge, "player_release_file_too_large", "A release file exceeds its configured size limit.")
			return
		}
		files[name] = path
	}
	for _, name := range []string{"tilecast-player.apk", "tilecast-player-update.json", "tilecast-player-update.json.sig"} {
		if files[name] == "" {
			writeError(w, http.StatusUnprocessableEntity, "player_release_file_missing", "Missing required release file: "+name+".")
			return
		}
	}
	manifest, err := os.ReadFile(files["tilecast-player-update.json"])
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	signature, err := os.ReadFile(files["tilecast-player-update.json.sig"])
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	var userID *uuid.UUID
	if session, ok := r.Context().Value(sessionContextKey).(auth.Session); ok {
		userID = &session.User.ID
	}
	result, err := s.updates.ImportUpload(r.Context(), files["tilecast-player.apk"], manifest, signature, userID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "player_release_verification_failed", err.Error())
		return
	}
	resourceID := result.ID.String()
	_, _ = s.db.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,'player_updates.release_uploaded','player_release',$3,$4)`, uuid.New(), userID, resourceID, map[string]any{"versionCode": result.Manifest.VersionCode, "channel": result.Manifest.Channel, "duplicate": result.Duplicate})
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": result.ID, "source": result.Source, "versionCode": result.Manifest.VersionCode, "versionName": result.Manifest.VersionName, "channel": result.Manifest.Channel, "apkSizeBytes": result.Manifest.APKSizeBytes, "releaseNotes": result.Manifest.ReleaseNotes, "cacheStatus": result.CacheStatus, "verificationStatus": result.VerificationStatus, "duplicate": result.Duplicate}})
}

func releaseUploadPartLimit(name, contentType string, maximum int64) (int64, bool) {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch name {
	case "tilecast-player.apk":
		return maximum, mediaType == "application/vnd.android.package-archive" || mediaType == "application/octet-stream"
	case "tilecast-player-update.json":
		return 128 << 10, mediaType == "application/json" || mediaType == "application/octet-stream"
	case "tilecast-player-update.json.sig":
		return 4 << 10, mediaType == "application/octet-stream" || mediaType == "text/plain"
	default:
		return 0, false
	}
}

func (s *server) checkPlayerReleases(w http.ResponseWriter, r *http.Request) {
	if !s.updates.ManifestKeyConfigured() {
		writeError(w, http.StatusServiceUnavailable, "update_manifest_key_missing", "Tilecast Player update trust is not configured. Rebuild the server with the official trust key or set TILECAST_UPDATE_MANIFEST_PUBLIC_KEY.")
		return
	}
	if err := s.updates.Check(r.Context()); err != nil {
		writeError(w, 502, "github_release_check_failed", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	_, _ = s.db.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'player_updates.checked','update_provider','github')`, uuid.New(), user.ID)
	writeJSON(w, 200, map[string]any{"data": map[string]any{"checked": true}})
}

func (s *server) cachePlayerRelease(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var status string
	if err := s.db.QueryRow(r.Context(), `UPDATE player_releases SET cache_status='downloading',verification_status='verified_manifest',verification_error=NULL,updated_at=now() WHERE id=$1 AND verification_status IN('verified_manifest','failed') AND cache_status<>'downloading' RETURNING cache_status`, id).Scan(&status); err != nil {
		writeError(w, 409, "player_release_not_importable", "Release is unavailable or already verified.")
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		if err := s.updates.Cache(ctx, id); err != nil {
			message := err.Error()
			if len(message) > 240 {
				message = message[:240]
			}
			_, _ = s.db.Exec(ctx, `UPDATE player_releases SET cache_status='failed',verification_status='failed',verification_error=$2,updated_at=now() WHERE id=$1`, id, message)
		}
	}()
	writeJSON(w, 202, map[string]any{"data": map[string]any{"id": id, "cacheStatus": status}})
}

type deploymentInput struct {
	ReleaseID              uuid.UUID   `json:"releaseId"`
	Name                   string      `json:"name"`
	Mode                   string      `json:"mode"`
	MaintenanceWindowStart *time.Time  `json:"maintenanceWindowStart"`
	ScreenIDs              []uuid.UUID `json:"screenIds"`
	GroupIDs               []uuid.UUID `json:"groupIds"`
	CanarySize             int         `json:"canarySize"`
}

func (s *server) createUpdateDeployment(w http.ResponseWriter, r *http.Request) {
	var input deploymentInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 180 || (input.Mode != "download_only" && input.Mode != "install_now" && input.Mode != "maintenance_window") || len(input.ScreenIDs)+len(input.GroupIDs) == 0 || input.CanarySize < 0 || input.CanarySize > 50 {
		writeError(w, 422, "update_deployment_invalid", "Name, deployment mode, and at least one target are required.")
		return
	}
	if input.Mode == "maintenance_window" && (input.MaintenanceWindowStart == nil || input.MaintenanceWindowStart.Before(time.Now())) {
		writeError(w, 422, "update_deployment_invalid", "Choose a future maintenance window.")
		return
	}
	var versionCode, apkSize int64
	var minimumSDK int
	var hash string
	if err := s.db.QueryRow(r.Context(), `SELECT version_code,minimum_sdk,apk_size,apk_sha256 FROM player_releases WHERE id=$1 AND verification_status='verified' AND cache_status='cached'`, input.ReleaseID).Scan(&versionCode, &minimumSDK, &apkSize, &hash); err != nil {
		writeError(w, 422, "player_release_not_verified", "Only fully verified cached releases can be deployed.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer tx.Rollback(r.Context())
	id := uuid.New()
	rolloutMode := "full"
	rolloutPhase := "full"
	if input.CanarySize > 0 {
		rolloutMode = "canary"
		rolloutPhase = "canary"
	}
	_, err = tx.Exec(r.Context(), `INSERT INTO update_deployments(id,release_id,name,mode,maintenance_window_start,created_by,status,started_at,rollout_mode,rollout_phase,canary_size)VALUES($1,$2,$3,$4,$5,$6,'active',now(),$7,$8,$9)`, id, input.ReleaseID, input.Name, input.Mode, input.MaintenanceWindowStart, user.ID, rolloutMode, rolloutPhase, input.CanarySize)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	for _, screen := range uniqueUUIDs(input.ScreenIDs) {
		_, _ = tx.Exec(r.Context(), `INSERT INTO update_deployment_targets(deployment_id,target_type,screen_id) SELECT $1,'screen',$2 WHERE EXISTS(SELECT 1 FROM screens WHERE id=$2 AND deleted_at IS NULL)`, id, screen)
	}
	for _, group := range uniqueUUIDs(input.GroupIDs) {
		_, _ = tx.Exec(r.Context(), `INSERT INTO update_deployment_targets(deployment_id,target_type,screen_group_id) SELECT $1,'group',$2 WHERE EXISTS(SELECT 1 FROM screen_groups WHERE id=$2 AND deleted_at IS NULL)`, id, group)
	}
	rows, err := tx.Query(r.Context(), `SELECT DISTINCT s.id,ps.player_version_code,ps.android_sdk,COALESCE(ps.install_permission_status,'unknown'),COALESCE(s.last_heartbeat_at>now()-interval '15 minutes',false) FROM screens s LEFT JOIN screen_player_status ps ON ps.screen_id=s.id WHERE s.deleted_at IS NULL AND (s.id=ANY($1) OR EXISTS(SELECT 1 FROM screen_group_memberships m WHERE m.screen_id=s.id AND m.screen_group_id=ANY($2))) ORDER BY s.id`, input.ScreenIDs, input.GroupIDs)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	type target struct {
		id         uuid.UUID
		current    *int64
		sdk        *int
		permission string
		recent     bool
	}
	targets := []target{}
	for rows.Next() {
		var item target
		if rows.Scan(&item.id, &item.current, &item.sdk, &item.permission, &item.recent) == nil {
			targets = append(targets, item)
		}
	}
	rows.Close()
	if len(targets) == 0 {
		writeError(w, 422, "update_target_required", "No eligible screens matched the targets.")
		return
	}
	canarySize := normalizedCanarySize(input.CanarySize, len(targets))
	if input.CanarySize > 0 && canarySize == 0 {
		rolloutMode = "full"
		rolloutPhase = "full"
		_, _ = tx.Exec(r.Context(), `UPDATE update_deployments SET rollout_mode='full',rollout_phase='full',canary_size=0 WHERE id=$1`, id)
	}
	for index, target := range targets {
		isCanary := canarySize > 0 && index < canarySize
		state := "pending"
		if !target.recent {
			state = "offline"
		}
		if target.sdk != nil && *target.sdk < minimumSDK {
			state = "incompatible"
		}
		if target.current != nil && *target.current >= versionCode {
			state = "already_current"
		}
		if canarySize > 0 && !isCanary && (state == "pending" || state == "offline") {
			state = "held"
		}
		_, _ = tx.Exec(r.Context(), `INSERT INTO screen_update_states(deployment_id,screen_id,previous_version_code,expected_version_code,permission_status,state,completed_at,is_canary)VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $6 IN('already_current','incompatible') THEN now() END,$7)`, id, target.id, target.current, versionCode, target.permission, state, isCanary)
		if state == "pending" || state == "offline" {
			payload, _ := json.Marshal(map[string]any{"deploymentId": id, "releaseId": input.ReleaseID, "expectedVersionCode": versionCode, "expectedApkSha256": hash, "installationMode": input.Mode, "maintenanceWindowStart": input.MaintenanceWindowStart})
			commandID := uuid.New()
			_, _ = tx.Exec(r.Context(), `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at) SELECT $1,organization_id,id,'install_player_update',$2,$1,$3,now()+interval '7 days' FROM screens WHERE id=$4`, commandID, payload, user.ID, target.id)
		}
	}
	_, _ = tx.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,'player_update.deployed','update_deployment',$3,jsonb_build_object('targetCount',$4,'duplicateTargetsRemoved',$5))`, uuid.New(), user.ID, id.String(), len(targets), len(input.ScreenIDs)+len(input.GroupIDs)-len(targets))
	if err := tx.Commit(r.Context()); err != nil {
		s.internalError(w, r, err)
		return
	}
	for _, target := range targets {
		s.devices.Notify(target.id, map[string]any{"type": "commands.available"})
	}
	writeJSON(w, 201, map[string]any{"data": map[string]any{"id": id, "status": "active", "targetCount": len(targets), "apkSizeBytes": apkSize, "rolloutMode": rolloutMode, "rolloutPhase": rolloutPhase, "canarySize": canarySize}})
}

func normalizedCanarySize(requested, targetCount int) int {
	if requested <= 0 || requested >= targetCount {
		return 0
	}
	return requested
}

func (s *server) listUpdateDeployments(w http.ResponseWriter, r *http.Request) {
	_, _ = s.db.Exec(r.Context(), `UPDATE update_deployments d SET status='paused',rollout_phase='paused',paused_at=now(),pause_reason='A canary did not reconnect within ten minutes.' WHERE d.status='active' AND d.rollout_phase='canary' AND EXISTS(SELECT 1 FROM screen_update_states st WHERE st.deployment_id=d.id AND st.is_canary AND st.state='reconnecting' AND st.updated_at<now()-interval '10 minutes')`)
	rows, err := s.db.Query(r.Context(), `SELECT d.id,d.name,d.mode,d.status,d.created_at,r.version_code,r.version_name,count(st.screen_id),count(*) FILTER(WHERE st.state='succeeded'),count(*) FILTER(WHERE st.state='failed'),count(*) FILTER(WHERE st.state IN ('waiting_for_permission','waiting_for_user')),d.rollout_mode,d.rollout_phase,d.canary_size,d.pause_reason FROM update_deployments d JOIN player_releases r ON r.id=d.release_id LEFT JOIN screen_update_states st ON st.deployment_id=d.id GROUP BY d.id,r.id ORDER BY d.created_at DESC LIMIT 100`)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id uuid.UUID
		var name, mode, status, version, rolloutMode, rolloutPhase string
		var pauseReason *string
		var created time.Time
		var code int64
		var total, succeeded, failed, waiting int
		var canarySize int
		if rows.Scan(&id, &name, &mode, &status, &created, &code, &version, &total, &succeeded, &failed, &waiting, &rolloutMode, &rolloutPhase, &canarySize, &pauseReason) == nil {
			items = append(items, map[string]any{"id": id, "name": name, "mode": mode, "status": status, "createdAt": created, "versionCode": code, "versionName": version, "targetCount": total, "succeededCount": succeeded, "failedCount": failed, "waitingForUserCount": waiting, "rolloutMode": rolloutMode, "rolloutPhase": rolloutPhase, "canarySize": canarySize, "pauseReason": pauseReason})
		}
	}
	writeJSON(w, 200, map[string]any{"data": map[string]any{"items": items}})
}

func (s *server) getUpdateDeployment(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	rows, err := s.db.Query(r.Context(), `SELECT st.screen_id,sc.name,st.previous_version_code,st.expected_version_code,st.downloaded_bytes,st.permission_status,st.installer_status,st.state,st.safe_error,st.updated_at FROM screen_update_states st JOIN screens sc ON sc.id=st.screen_id WHERE st.deployment_id=$1 ORDER BY sc.name,sc.id`, id)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var screen uuid.UUID
		var name, state string
		var previous *int64
		var expected, downloaded int64
		var permission, installer, errorText *string
		var updated time.Time
		if rows.Scan(&screen, &name, &previous, &expected, &downloaded, &permission, &installer, &state, &errorText, &updated) == nil {
			items = append(items, map[string]any{"screenId": screen, "screenName": name, "previousVersionCode": previous, "expectedVersionCode": expected, "downloadedBytes": downloaded, "permissionStatus": permission, "installerStatus": installer, "state": state, "safeError": errorText, "updatedAt": updated})
		}
	}
	writeJSON(w, 200, map[string]any{"data": map[string]any{"id": id, "screens": items}})
}

func (s *server) cancelUpdateDeployment(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE update_deployments SET status='cancelled',cancelled_at=now() WHERE id=$1 AND status='active'`, id)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 409, "update_deployment_completed", "Deployment is no longer active.")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE screen_update_states SET state='cancelled',completed_at=now(),updated_at=now() WHERE deployment_id=$1 AND state NOT IN ('succeeded','already_current')`, id)
	_, _ = s.db.Exec(r.Context(), `UPDATE player_commands SET state='cancelled',completed_at=now(),updated_at=now() WHERE payload->>'deploymentId'=$1 AND type='install_player_update' AND state IN ('pending','delivered','acknowledged')`, id.String())
	writeJSON(w, 200, map[string]any{"data": map[string]any{"id": id, "status": "cancelled"}})
}

func (s *server) retryUpdateScreen(w http.ResponseWriter, r *http.Request) {
	deployment, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	screen, ok := urlUUID(w, r, "screenId")
	if !ok {
		return
	}
	var release uuid.UUID
	var version int64
	var hash, mode string
	if err := s.db.QueryRow(r.Context(), `SELECT d.release_id,pr.version_code,pr.apk_sha256,d.mode FROM update_deployments d JOIN player_releases pr ON pr.id=d.release_id JOIN screen_update_states st ON st.deployment_id=d.id AND st.screen_id=$2 WHERE d.id=$1 AND st.state='failed'`, deployment, screen).Scan(&release, &version, &hash, &mode); err != nil {
		writeError(w, 409, "update_retry_not_allowed", "Only failed screen updates can be retried.")
		return
	}
	payload, _ := json.Marshal(map[string]any{"deploymentId": deployment, "releaseId": release, "expectedVersionCode": version, "expectedApkSha256": hash, "installationMode": mode})
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	command := uuid.New()
	_, err := s.db.Exec(r.Context(), `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at) SELECT $1,organization_id,id,'install_player_update',$2,$1,$3,now()+interval '7 days' FROM screens WHERE id=$4`, command, payload, user.ID, screen)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE screen_update_states SET state='pending',safe_error=NULL,downloaded_bytes=0,updated_at=now() WHERE deployment_id=$1 AND screen_id=$2`, deployment, screen)
	s.devices.Notify(screen, map[string]any{"type": "commands.available"})
	writeJSON(w, 202, map[string]any{"data": map[string]any{"state": "pending"}})
}

func (s *server) playerUpdateMetadata(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	release, ok := urlUUID(w, r, "releaseId")
	if !ok {
		return
	}
	var code, size int64
	var name, hash, cert string
	var sdk int
	if err := s.db.QueryRow(r.Context(), `SELECT pr.version_code,pr.version_name,pr.minimum_sdk,pr.apk_size,pr.apk_sha256,pr.signing_certificate_sha256 FROM player_releases pr WHERE pr.id=$1 AND pr.verification_status='verified' AND EXISTS(SELECT 1 FROM screen_update_states st JOIN update_deployments d ON d.id=st.deployment_id WHERE st.screen_id=$2 AND d.release_id=pr.id AND d.status='active' AND st.state NOT IN ('cancelled','incompatible'))`, release, principal.ScreenID).Scan(&code, &name, &sdk, &size, &hash, &cert); err != nil {
		writeError(w, 404, "player_update_not_found", "Update is unavailable for this screen.")
		return
	}
	writeJSON(w, 200, map[string]any{"data": map[string]any{"releaseId": release, "applicationId": "org.tilecast.player", "versionCode": code, "versionName": name, "minimumSdk": sdk, "apkSizeBytes": size, "apkSha256": hash, "signingCertificateSha256": cert, "apkPath": fmt.Sprintf("/api/v1/player/updates/%s/apk", release)}})
}

func (s *server) playerUpdateAPK(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	release, ok := urlUUID(w, r, "releaseId")
	if !ok {
		return
	}
	var allowed bool
	_ = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM screen_update_states st JOIN update_deployments d ON d.id=st.deployment_id WHERE st.screen_id=$1 AND d.release_id=$2 AND d.status='active' AND st.state NOT IN ('cancelled','incompatible'))`, principal.ScreenID, release).Scan(&allowed)
	if !allowed {
		writeError(w, 403, "player_update_not_targeted", "This screen is not targeted for the update.")
		return
	}
	path, size, hash, err := s.updates.APKPath(r.Context(), release)
	if err != nil {
		writeError(w, 404, "player_update_not_found", "Verified update APK is unavailable.")
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writeError(w, 404, "player_update_not_found", "Verified update APK is unavailable.")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("ETag", `"sha256-`+hash+`"`)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", `attachment; filename="tilecast-player.apk"`)
	http.ServeContent(w, r, "tilecast-player.apk", time.Time{}, ioSection{file, size})
}

type ioSection struct {
	*os.File
	size int64
}

func (f ioSection) Seek(offset int64, whence int) (int64, error) { return f.File.Seek(offset, whence) }

func (s *server) playerUpdateStatus(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	deployment, ok := urlUUID(w, r, "deploymentId")
	if !ok {
		return
	}
	var body struct {
		State            string `json:"state"`
		DownloadedBytes  int64  `json:"downloadedBytes"`
		PermissionStatus string `json:"permissionStatus"`
		InstallerStatus  string `json:"installerStatus"`
		Error            string `json:"error"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	allowed := map[string]bool{"downloading": true, "downloaded": true, "verifying": true, "ready": true, "waiting_for_permission": true, "waiting_for_user": true, "installing": true, "reconnecting": true, "failed": true}
	if !allowed[body.State] || body.DownloadedBytes < 0 || len(body.Error) > 240 {
		writeError(w, 422, "update_status_invalid", "Update status is invalid.")
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE screen_update_states SET state=$3,downloaded_bytes=$4,permission_status=NULLIF($5,''),installer_status=NULLIF($6,''),safe_error=NULLIF($7,''),download_started_at=CASE WHEN $3='downloading' THEN COALESCE(download_started_at,now()) ELSE download_started_at END,downloaded_at=CASE WHEN $3 IN('downloaded','verifying','ready','waiting_for_permission','waiting_for_user','installing','reconnecting') THEN COALESCE(downloaded_at,now()) ELSE downloaded_at END,install_started_at=CASE WHEN $3='installing' THEN COALESCE(install_started_at,now()) ELSE install_started_at END,updated_at=now() WHERE deployment_id=$1 AND screen_id=$2 AND state NOT IN('cancelled','succeeded')`, deployment, principal.ScreenID, body.State, body.DownloadedBytes, body.PermissionStatus, body.InstallerStatus, body.Error)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 409, "update_deployment_cancelled", "Deployment is cancelled or complete.")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE screen_player_status SET current_update_deployment_id=$2,update_state=$3,update_downloaded_bytes=$4,update_error=NULLIF($5,'') WHERE screen_id=$1`, principal.ScreenID, deployment, body.State, body.DownloadedBytes, body.Error)
	s.advanceCanaryDeployment(r.Context(), deployment, body.State == "failed")
	writeJSON(w, 200, map[string]any{"data": map[string]any{"state": body.State}})
}

func (s *server) advanceCanaryDeployment(ctx context.Context, deployment uuid.UUID, failed bool) {
	var phase string
	if s.db.QueryRow(ctx, `SELECT rollout_phase FROM update_deployments WHERE id=$1 AND status='active'`, deployment).Scan(&phase) != nil || phase != "canary" {
		return
	}
	if failed {
		_, _ = s.db.Exec(ctx, `UPDATE update_deployments SET status='paused',rollout_phase='paused',paused_at=now(),pause_reason='A canary player reported an update failure.' WHERE id=$1 AND status='active'`, deployment)
		return
	}
	var remaining int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM screen_update_states WHERE deployment_id=$1 AND is_canary AND state NOT IN('succeeded','already_current')`, deployment).Scan(&remaining)
	if remaining != 0 {
		return
	}
	rows, err := s.db.Query(ctx, `UPDATE screen_update_states SET state='pending',updated_at=now() WHERE deployment_id=$1 AND state='held' RETURNING screen_id`, deployment)
	if err != nil {
		return
	}
	var screens []uuid.UUID
	for rows.Next() {
		var screen uuid.UUID
		if rows.Scan(&screen) == nil {
			screens = append(screens, screen)
		}
	}
	rows.Close()
	var release uuid.UUID
	var version int64
	var hash, mode string
	var window *time.Time
	var creator *uuid.UUID
	if s.db.QueryRow(ctx, `SELECT d.release_id,r.version_code,r.apk_sha256,d.mode,d.maintenance_window_start,d.created_by FROM update_deployments d JOIN player_releases r ON r.id=d.release_id WHERE d.id=$1`, deployment).Scan(&release, &version, &hash, &mode, &window, &creator) != nil {
		return
	}
	for _, screen := range screens {
		payload, _ := json.Marshal(map[string]any{"deploymentId": deployment, "releaseId": release, "expectedVersionCode": version, "expectedApkSha256": hash, "installationMode": mode, "maintenanceWindowStart": window})
		command := uuid.New()
		_, _ = s.db.Exec(ctx, `INSERT INTO player_commands(id,organization_id,screen_id,type,payload,idempotency_key,created_by,expires_at) SELECT $1,organization_id,id,'install_player_update',$2,$1,$3,now()+interval '7 days' FROM screens WHERE id=$4`, command, payload, creator, screen)
		s.devices.Notify(screen, map[string]any{"type": "commands.available"})
	}
	_, _ = s.db.Exec(ctx, `UPDATE update_deployments SET rollout_phase='full' WHERE id=$1 AND status='active'`, deployment)
}

func (s *server) advanceCanaryDeploymentsForScreen(ctx context.Context, screen uuid.UUID) {
	rows, err := s.db.Query(ctx, `SELECT DISTINCT d.id FROM update_deployments d JOIN screen_update_states current ON current.deployment_id=d.id AND current.screen_id=$1 AND current.is_canary WHERE d.status='active' AND d.rollout_phase='canary' AND current.state IN('succeeded','already_current') AND NOT EXISTS(SELECT 1 FROM screen_update_states remaining WHERE remaining.deployment_id=d.id AND remaining.is_canary AND remaining.state NOT IN('succeeded','already_current'))`, screen)
	if err != nil {
		return
	}
	var deployments []uuid.UUID
	for rows.Next() {
		var deployment uuid.UUID
		if rows.Scan(&deployment) == nil {
			deployments = append(deployments, deployment)
		}
	}
	rows.Close()
	for _, deployment := range deployments {
		s.advanceCanaryDeployment(ctx, deployment, false)
	}
}
