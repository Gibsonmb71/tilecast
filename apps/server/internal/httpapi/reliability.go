package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
)

var powerResultValues = map[string]bool{"untested": true, "confirmed_working": true, "partially_working": true, "failed": true, "unsupported": true}

func (s *server) screenReliability(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var raw []byte
	err := s.db.QueryRow(r.Context(), `SELECT jsonb_build_object(
		'configuredMode',ps.configured_reliability_mode,'effectiveMode',ps.effective_reliability_mode,
		'foregroundState',ps.foreground_state,'lastForegroundExitAt',ps.last_foreground_exit_at,
		'lastForegroundPackage',CASE WHEN $2 THEN ps.last_foreground_package ELSE NULL END,
		'bootRecoveryResult',ps.boot_recovery_result,'lastSuccessfulColdBootAt',ps.last_successful_cold_boot_at,
		'immersiveModeActive',ps.immersive_mode_active,'keepScreenOn',ps.keep_screen_on,
		'managedKioskCapability',ps.managed_kiosk_capability,'deviceOwnerState',ps.device_owner_state,
		'lockTaskState',ps.lock_task_state,'accessibilityServiceState',ps.accessibility_service_state,
		'accessibilityReturnState',ps.accessibility_return_state,'accessibilityReturnAttempts',ps.accessibility_return_attempts,
		'activeHoursState',ps.active_hours_state,'sleepCapability',ps.sleep_capability,
		'lastSleepRequestResult',ps.last_sleep_request_result,'lastWakeResult',ps.last_wake_result,
		'recoveryLevel',ps.recovery_level,'recoveryCount',ps.recovery_count,'safeMode',ps.safe_mode,
		'lastWatchdogFailure',ps.last_watchdog_failure,'lastWatchdogRecoveryAt',ps.last_watchdog_recovery_at,
		'maintenanceSessionExpiresAt',ps.maintenance_session_expires_at,
		'powerAssist',jsonb_build_object('deviceSleep',COALESCE(pa.device_sleep,'untested'),'tvStandby',COALESCE(pa.tv_standby,'untested'),'deviceWake',COALESCE(pa.device_wake,'untested'),'tvWake',COALESCE(pa.tv_wake,'untested'),'inputSelection',COALESCE(pa.input_selection,'untested'),'tilecastStartup',COALESCE(pa.tilecast_startup,'untested'),'lastTestedAt',pa.last_tested_at)
	) FROM screens sc LEFT JOIN screen_player_status ps ON ps.screen_id=sc.id LEFT JOIN screen_power_assist_results pa ON pa.screen_id=sc.id WHERE sc.id=$1`, id, detailedDiagnostics(r)).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, 404, "screen_not_found", "Screen was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	var data any
	_ = json.Unmarshal(raw, &data)
	writeJSON(w, 200, map[string]any{"data": data})
}

type powerConfirmationInput struct {
	DeviceSleep     string `json:"deviceSleep"`
	TVStandby       string `json:"tvStandby"`
	DeviceWake      string `json:"deviceWake"`
	TVWake          string `json:"tvWake"`
	InputSelection  string `json:"inputSelection"`
	TilecastStartup string `json:"tilecastStartup"`
}

func (s *server) confirmPowerAssist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var input powerConfirmationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, 400, "invalid_request", err.Error())
		return
	}
	values := []*string{&input.DeviceSleep, &input.TVStandby, &input.DeviceWake, &input.TVWake, &input.InputSelection, &input.TilecastStartup}
	for _, value := range values {
		if *value == "" {
			*value = "untested"
		}
		if !powerResultValues[*value] {
			writeError(w, 422, "invalid_power_assist_result", "Power Assist results must use a supported state.")
			return
		}
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	tag, err := s.db.Exec(r.Context(), `INSERT INTO screen_power_assist_results(screen_id,device_sleep,tv_standby,device_wake,tv_wake,input_selection,tilecast_startup,last_tested_at,updated_by) SELECT $1,$2,$3,$4,$5,$6,$7,now(),$8 WHERE EXISTS(SELECT 1 FROM screens WHERE id=$1) ON CONFLICT(screen_id) DO UPDATE SET device_sleep=$2,tv_standby=$3,device_wake=$4,tv_wake=$5,input_selection=$6,tilecast_startup=$7,last_tested_at=now(),updated_by=$8,updated_at=now()`, id, input.DeviceSleep, input.TVStandby, input.DeviceWake, input.TVWake, input.InputSelection, input.TilecastStartup, user.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, 404, "screen_not_found", "Screen was not found.")
		return
	}
	metadata, _ := json.Marshal(map[string]any{"deviceSleep": input.DeviceSleep, "tvStandby": input.TVStandby, "deviceWake": input.DeviceWake, "tvWake": input.TVWake, "inputSelection": input.InputSelection, "tilecastStartup": input.TilecastStartup})
	_, _ = s.db.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,'power_assist.confirmed','screen',$3,$4)`, uuid.New(), user.ID, id.String(), metadata)
	writeJSON(w, 200, map[string]any{"data": map[string]any{"screenId": id, "lastTestedAt": time.Now().UTC()}})
}

func detailedDiagnostics(r *http.Request) bool {
	session, ok := r.Context().Value(sessionContextKey).(auth.Session)
	return ok && (session.User.Role == "owner" || session.User.Role == "administrator")
}
