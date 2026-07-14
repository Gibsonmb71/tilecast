package settings

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrRevisionConflict = errors.New("settings revision conflict")

type Notifier interface{ ConfigChanged(uuid.UUID, int64) }
type HardLimits struct {
	MaxUploadBytes                                          int64
	MaxEmergencyMinutes, MaxWebsiteTimeout, MaxPrefetchDays int
	PrivateHTTPAllowed                                      bool
}
type Service struct {
	db       *pgxpool.Pool
	notifier Notifier
	limits   HardLimits
}
type Document struct {
	SchemaVersion int            `json:"schemaVersion"`
	Revision      int64          `json:"revision"`
	Values        map[string]any `json:"values"`
	Definitions   []Definition   `json:"definitions,omitempty"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}
type PolicyDocument struct {
	SchemaVersion int            `json:"schemaVersion"`
	Revision      int64          `json:"revision"`
	Priority      int            `json:"priority,omitempty"`
	Values        map[string]any `json:"values"`
	UpdatedAt     time.Time      `json:"updatedAt"`
}
type EffectiveValue struct {
	Value    any        `json:"value"`
	Source   string     `json:"source"`
	SourceID *uuid.UUID `json:"sourceId,omitempty"`
}
type EffectivePolicy struct {
	Values               map[string]EffectiveValue `json:"values"`
	OrganizationRevision int64                     `json:"organizationRevision"`
	GroupRevisions       map[string]int64          `json:"groupRevisions"`
	ScreenRevision       int64                     `json:"screenRevision"`
	ConfigRevision       int64                     `json:"configRevision"`
	Hash                 string                    `json:"hash"`
}
type PlayerConfig struct {
	SchemaVersion  int            `json:"schemaVersion"`
	ConfigRevision int64          `json:"configRevision"`
	GeneratedAt    time.Time      `json:"generatedAt"`
	Branding       map[string]any `json:"branding"`
	Playback       map[string]any `json:"playback"`
	Cache          map[string]any `json:"cache"`
	Sync           map[string]any `json:"sync"`
	Website        map[string]any `json:"website"`
	Reliability    map[string]any `json:"reliability"`
	Power          map[string]any `json:"power"`
	ManagedKiosk   map[string]any `json:"managedKiosk"`
	Accessibility  map[string]any `json:"accessibility"`
	Updates        map[string]any `json:"updates"`
}

func NewService(db *pgxpool.Pool, notifier Notifier, limits HardLimits) *Service {
	return &Service{db: db, notifier: notifier, limits: limits}
}
func (s *Service) Organization(ctx context.Context) (Document, error) {
	var values []byte
	var d Document
	d.Definitions = Definitions()
	err := s.db.QueryRow(ctx, `SELECT schema_version,revision,settings,updated_at FROM organization_runtime_settings`).Scan(&d.SchemaVersion, &d.Revision, &values, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		var org uuid.UUID
		if err = s.db.QueryRow(ctx, `SELECT id FROM organization_settings`).Scan(&org); err != nil {
			return d, err
		}
		_, err = s.db.Exec(ctx, `INSERT INTO organization_runtime_settings(organization_id)VALUES($1)`, org)
		if err != nil {
			return d, err
		}
		return s.Organization(ctx)
	}
	if err != nil {
		return d, err
	}
	_ = json.Unmarshal(values, &d.Values)
	d.Values = mergeDefaults(d.Values, ScopeOrganization)
	var name string
	if s.db.QueryRow(ctx, `SELECT organization_name FROM organization_settings`).Scan(&name) == nil {
		d.Values["organization.name"] = name
	}
	return d, nil
}
func (s *Service) UpdateOrganization(ctx context.Context, user uuid.UUID, revision int64, values map[string]any) (Document, error) {
	validated, err := Validate(values, ScopeOrganization)
	if err != nil {
		return Document{}, err
	}
	if err = s.hardLimits(validated); err != nil {
		return Document{}, err
	}
	if err = s.validateBranding(ctx, validated); err != nil {
		return Document{}, err
	}
	encoded, _ := json.Marshal(validated)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Document{}, err
	}
	defer tx.Rollback(ctx)
	var next int64
	var org uuid.UUID
	err = tx.QueryRow(ctx, `UPDATE organization_runtime_settings SET settings=$1,revision=revision+1,updated_by=$2,updated_at=now() WHERE revision=$3 RETURNING revision,organization_id`, encoded, user, revision).Scan(&next, &org)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrRevisionConflict
	}
	if err != nil {
		return Document{}, err
	}
	if name, ok := validated["organization.name"].(string); ok && name != "" {
		if _, err = tx.Exec(ctx, `UPDATE organization_settings SET organization_name=$1,updated_at=now() WHERE id=$2`, name, org); err != nil {
			return Document{}, err
		}
	}
	if timezone, ok := validated["organization.timezone"].(string); ok && timezone != "" {
		if _, err = tx.Exec(ctx, `UPDATE organization_settings SET default_timezone=$1,updated_at=now() WHERE id=$2`, timezone, org); err != nil {
			return Document{}, err
		}
	}
	keys := sortedKeys(validated)
	metadata, _ := json.Marshal(map[string]any{"changedKeys": keys, "revision": next, "scope": "organization"})
	_, _ = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,'settings.organization_changed','organization',$3,$4)`, uuid.New(), user, org.String(), metadata)
	screens, err := bumpAll(ctx, tx, "organization.settings_changed")
	if err != nil {
		return Document{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Document{}, err
	}
	s.notify(screens)
	return s.Organization(ctx)
}
func (s *Service) Preferences(ctx context.Context, user uuid.UUID) (Document, error) {
	var d Document
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT schema_version,revision,preferences,updated_at FROM user_preferences WHERE user_id=$1`, user).Scan(&d.SchemaVersion, &d.Revision, &raw, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		_, err = s.db.Exec(ctx, `INSERT INTO user_preferences(user_id)VALUES($1)`, user)
		if err != nil {
			return d, err
		}
		return s.Preferences(ctx, user)
	}
	if err != nil {
		return d, err
	}
	_ = json.Unmarshal(raw, &d.Values)
	d.Values = mergeDefaults(d.Values, ScopePreference)
	d.Definitions = filterDefinitions(ScopePreference)
	return d, nil
}
func (s *Service) UpdatePreferences(ctx context.Context, user uuid.UUID, revision int64, values map[string]any) (Document, error) {
	validated, err := Validate(values, ScopePreference)
	if err != nil {
		return Document{}, err
	}
	raw, _ := json.Marshal(validated)
	tag, err := s.db.Exec(ctx, `UPDATE user_preferences SET preferences=$1,revision=revision+1,updated_at=now() WHERE user_id=$2 AND revision=$3`, raw, user, revision)
	if err != nil {
		return Document{}, err
	}
	if tag.RowsAffected() == 0 {
		return Document{}, ErrRevisionConflict
	}
	return s.Preferences(ctx, user)
}
func (s *Service) GroupPolicy(ctx context.Context, id uuid.UUID) (PolicyDocument, error) {
	var d PolicyDocument
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT schema_version,revision,priority,policy,updated_at FROM screen_group_player_policies WHERE screen_group_id=$1`, id).Scan(&d.SchemaVersion, &d.Revision, &d.Priority, &raw, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		d = PolicyDocument{SchemaVersion: SchemaVersion, Revision: 0, Values: map[string]any{}}
		return d, nil
	}
	_ = json.Unmarshal(raw, &d.Values)
	return d, err
}
func (s *Service) PutGroupPolicy(ctx context.Context, user, id uuid.UUID, revision int64, priority int, values map[string]any) (PolicyDocument, error) {
	if priority < -1000 || priority > 1000 {
		return PolicyDocument{}, errors.New("invalid_setting_value: policy priority")
	}
	validated, err := Validate(values, ScopePolicy)
	if err != nil {
		return PolicyDocument{}, err
	}
	raw, _ := json.Marshal(validated)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return PolicyDocument{}, err
	}
	defer tx.Rollback(ctx)
	var next int64
	if revision == 0 {
		err = tx.QueryRow(ctx, `INSERT INTO screen_group_player_policies(screen_group_id,priority,policy,updated_by)VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING revision`, id, priority, raw, user).Scan(&next)
	} else {
		err = tx.QueryRow(ctx, `UPDATE screen_group_player_policies SET priority=$2,policy=$3,revision=revision+1,updated_by=$4,updated_at=now() WHERE screen_group_id=$1 AND revision=$5 RETURNING revision`, id, priority, raw, user, revision).Scan(&next)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return PolicyDocument{}, ErrRevisionConflict
	}
	if err != nil {
		return PolicyDocument{}, err
	}
	notes, err := bumpGroup(ctx, tx, id, "group.policy_changed")
	if err != nil {
		return PolicyDocument{}, err
	}
	s.audit(ctx, tx, user, "settings.group_policy_changed", "screen_group", id, validated, next)
	if err = tx.Commit(ctx); err != nil {
		return PolicyDocument{}, err
	}
	s.notify(notes)
	return s.GroupPolicy(ctx, id)
}
func (s *Service) DeleteGroupPolicy(ctx context.Context, user, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `DELETE FROM screen_group_player_policies WHERE screen_group_id=$1`, id)
	if err != nil {
		return err
	}
	notes, err := bumpGroup(ctx, tx, id, "group.policy_reset")
	if err != nil {
		return err
	}
	s.audit(ctx, tx, user, "settings.group_policy_reset", "screen_group", id, map[string]any{}, 0)
	if err = tx.Commit(ctx); err == nil {
		s.notify(notes)
	}
	return err
}
func (s *Service) ScreenPolicy(ctx context.Context, id uuid.UUID) (PolicyDocument, error) {
	var d PolicyDocument
	var raw []byte
	err := s.db.QueryRow(ctx, `SELECT schema_version,revision,policy,updated_at FROM screen_player_policies WHERE screen_id=$1`, id).Scan(&d.SchemaVersion, &d.Revision, &raw, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return PolicyDocument{SchemaVersion: 1, Values: map[string]any{}}, nil
	}
	_ = json.Unmarshal(raw, &d.Values)
	return d, err
}
func (s *Service) PutScreenPolicy(ctx context.Context, user, id uuid.UUID, revision int64, values map[string]any) (PolicyDocument, error) {
	validated, err := Validate(values, ScopePolicy)
	if err != nil {
		return PolicyDocument{}, err
	}
	raw, _ := json.Marshal(validated)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return PolicyDocument{}, err
	}
	defer tx.Rollback(ctx)
	if revision == 0 {
		err = tx.QueryRow(ctx, `INSERT INTO screen_player_policies(screen_id,policy,updated_by)VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING revision`, id, raw, user).Scan(&revision)
	} else {
		err = tx.QueryRow(ctx, `UPDATE screen_player_policies SET policy=$2,revision=revision+1,updated_by=$3,updated_at=now() WHERE screen_id=$1 AND revision=$4 RETURNING revision`, id, raw, user, revision).Scan(&revision)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return PolicyDocument{}, ErrRevisionConflict
	}
	if err != nil {
		return PolicyDocument{}, err
	}
	notes, err := bumpScreens(ctx, tx, []uuid.UUID{id}, "screen.policy_changed")
	if err != nil {
		return PolicyDocument{}, err
	}
	s.audit(ctx, tx, user, "settings.screen_policy_changed", "screen", id, validated, revision)
	if err = tx.Commit(ctx); err != nil {
		return PolicyDocument{}, err
	}
	s.notify(notes)
	return s.ScreenPolicy(ctx, id)
}
func (s *Service) DeleteScreenPolicy(ctx context.Context, user, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `DELETE FROM screen_player_policies WHERE screen_id=$1`, id)
	if err != nil {
		return err
	}
	notes, err := bumpScreens(ctx, tx, []uuid.UUID{id}, "screen.policy_reset")
	if err != nil {
		return err
	}
	s.audit(ctx, tx, user, "settings.screen_policy_reset", "screen", id, map[string]any{}, 0)
	if err = tx.Commit(ctx); err == nil {
		s.notify(notes)
	}
	return err
}

func (s *Service) Effective(ctx context.Context, screen uuid.UUID) (EffectivePolicy, error) {
	org, err := s.Organization(ctx)
	if err != nil {
		return EffectivePolicy{}, err
	}
	result := EffectivePolicy{Values: map[string]EffectiveValue{}, OrganizationRevision: org.Revision, GroupRevisions: map[string]int64{}}
	for _, d := range definitions {
		if d.Scope == ScopePolicy {
			value := d.Default
			if v, ok := org.Values[d.Key]; ok {
				value = v
			}
			result.Values[d.Key] = EffectiveValue{Value: value, Source: "Organization default"}
		}
	}
	rows, err := s.db.Query(ctx, `SELECT g.id,g.name,p.revision,p.policy FROM screen_group_memberships m JOIN screen_groups g ON g.id=m.screen_group_id JOIN screen_group_player_policies p ON p.screen_group_id=g.id WHERE m.screen_id=$1 AND g.deleted_at IS NULL ORDER BY p.priority DESC,g.id ASC`, screen)
	if err != nil {
		return result, err
	}
	claimed := map[string]bool{}
	for rows.Next() {
		var id uuid.UUID
		var name string
		var revision int64
		var raw []byte
		if rows.Scan(&id, &name, &revision, &raw) != nil {
			continue
		}
		result.GroupRevisions[id.String()] = revision
		var values map[string]any
		_ = json.Unmarshal(raw, &values)
		for key, value := range values {
			if !claimed[key] {
				copyID := id
				result.Values[key] = EffectiveValue{Value: value, Source: name, SourceID: &copyID}
				claimed[key] = true
			}
		}
	}
	rows.Close()
	screenPolicy, err := s.ScreenPolicy(ctx, screen)
	if err != nil {
		return result, err
	}
	result.ScreenRevision = screenPolicy.Revision
	for key, value := range screenPolicy.Values {
		copyID := screen
		result.Values[key] = EffectiveValue{Value: value, Source: "This screen", SourceID: &copyID}
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO screen_config_state(screen_id)VALUES($1)ON CONFLICT DO NOTHING`, screen)
	_ = s.db.QueryRow(ctx, `SELECT config_revision FROM screen_config_state WHERE screen_id=$1`, screen).Scan(&result.ConfigRevision)
	encoded, _ := json.Marshal(result.Values)
	maxCache, _ := result.Values["player.cache.max_bytes"].Value.(float64)
	minimumFree, _ := result.Values["player.cache.minimum_free_bytes"].Value.(float64)
	if minimumFree > maxCache {
		return result, errors.New("policy_conflict: minimum free storage exceeds cache maximum")
	}
	sum := sha256.Sum256(encoded)
	result.Hash = hex.EncodeToString(sum[:])
	return result, nil
}
func (s *Service) PlayerConfiguration(ctx context.Context, screen uuid.UUID) (PlayerConfig, string, error) {
	effective, err := s.Effective(ctx, screen)
	if err != nil {
		return PlayerConfig{}, "", err
	}
	org, err := s.Organization(ctx)
	if err != nil {
		return PlayerConfig{}, "", err
	}
	var name string
	_ = s.db.QueryRow(ctx, `SELECT organization_name FROM organization_settings`).Scan(&name)
	var screenLocation string
	_ = s.db.QueryRow(ctx, `SELECT location FROM screens WHERE id=$1`, screen).Scan(&screenLocation)
	v := func(key string) any { return effective.Values[key].Value }
	o := func(key string) any { return org.Values[key] }
	config := PlayerConfig{SchemaVersion: 1, ConfigRevision: effective.ConfigRevision, GeneratedAt: time.Now().UTC(), Branding: map[string]any{"organizationName": name, "logoAssetId": o("branding.logo_asset_id"), "backgroundColor": o("branding.player_background_color"), "textColor": o("branding.player_text_color"), "noContentTitle": o("branding.no_content_title"), "noContentMessage": o("branding.no_content_message"), "disabledTitle": o("branding.disabled_title"), "disabledMessage": o("branding.disabled_message"), "footerText": o("branding.footer_text")}, Playback: map[string]any{"defaultVolume": v("player.playback.default_volume"), "defaultFitMode": v("player.playback.default_fit_mode"), "identifyShowsLocation": v("player.identify.show_location"), "screenLocation": screenLocation}, Cache: map[string]any{"maximumBytes": v("player.cache.max_bytes"), "minimumFreeBytes": v("player.cache.minimum_free_bytes"), "concurrentDownloads": v("player.download.concurrent_limit"), "automaticThresholdBytes": v("player.download.automatic_threshold_bytes")}, Sync: map[string]any{"manifestReconciliationSeconds": v("player.sync.manifest_seconds"), "statusReportSeconds": v("player.sync.status_seconds")}, Website: map[string]any{"timeoutSeconds": v("player.website.timeout_seconds"), "cookiePolicy": v("player.website.cookie_policy"), "clearOnRestart": v("player.website.clear_on_restart")},
		Reliability:   map[string]any{"mode": v("reliability.mode"), "launchAfterBoot": v("reliability.launch_after_boot"), "immersiveMode": v("reliability.immersive_mode"), "foregroundWatchdogEnabled": v("reliability.foreground_watchdog_enabled"), "playbackStallSeconds": v("reliability.playback_stall_seconds"), "webviewStallSeconds": v("reliability.webview_stall_seconds"), "maximumProcessRestarts": v("reliability.maximum_process_restarts"), "restartWindowMinutes": v("reliability.restart_window_minutes"), "safeModeEnabled": v("reliability.safe_mode_enabled")},
		Power:         map[string]any{"activeHoursEnabled": v("power.active_hours_enabled"), "activeHoursTimezone": v("power.active_hours_timezone"), "activeHoursDays": v("power.active_hours_days"), "activeHoursStart": v("power.active_hours_start"), "activeHoursEnd": v("power.active_hours_end"), "startupGraceSeconds": v("power.startup_grace_seconds"), "shutdownPrepareSeconds": v("power.shutdown_prepare_seconds"), "keepScreenOn": v("power.keep_screen_on"), "cecAssistEnabled": v("power.cec_assist_enabled"), "sleepOutsideActiveHours": v("power.sleep_outside_active_hours"), "blackScreenFallback": v("power.black_screen_fallback")},
		ManagedKiosk:  map[string]any{"lockTaskEnabled": v("managed_kiosk.lock_task_enabled"), "blockOverlays": v("managed_kiosk.block_overlays"), "allowSettingsDuringAdmin": v("managed_kiosk.allow_settings_during_admin"), "adminSessionMinutes": v("managed_kiosk.admin_session_minutes")},
		Accessibility: map[string]any{"controlAssistEnabled": v("accessibility.control_assist_enabled"), "returnDelaySeconds": v("accessibility.return_delay_seconds"), "allowedPackages": v("accessibility.allowed_packages"), "pauseDuringUpdates": v("accessibility.pause_during_updates"), "pauseDuringAdminSession": v("accessibility.pause_during_admin_session"), "reportForegroundPackage": v("accessibility.report_foreground_package"), "maximumReturns": v("accessibility.maximum_returns"), "returnWindowMinutes": v("accessibility.return_window_minutes")},
		Updates:       map[string]any{"channel": v("player.update.channel")}}
	return config, fmt.Sprintf(`"config-%s-%d"`, screen, effective.ConfigRevision), nil
}

type note struct {
	id       uuid.UUID
	revision int64
}

func bumpAll(ctx context.Context, tx pgx.Tx, reason string) ([]note, error) {
	rows, err := tx.Query(ctx, `UPDATE screen_config_state SET config_revision=config_revision+1,changed_at=now(),change_reason=$1 RETURNING screen_id,config_revision`, reason)
	return scanNotes(rows, err)
}
func bumpGroup(ctx context.Context, tx pgx.Tx, group uuid.UUID, reason string) ([]note, error) {
	rows, err := tx.Query(ctx, `UPDATE screen_config_state SET config_revision=config_revision+1,changed_at=now(),change_reason=$2 WHERE screen_id IN(SELECT screen_id FROM screen_group_memberships WHERE screen_group_id=$1) RETURNING screen_id,config_revision`, group, reason)
	return scanNotes(rows, err)
}
func bumpScreens(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, reason string) ([]note, error) {
	rows, err := tx.Query(ctx, `UPDATE screen_config_state SET config_revision=config_revision+1,changed_at=now(),change_reason=$2 WHERE screen_id=ANY($1) RETURNING screen_id,config_revision`, ids, reason)
	return scanNotes(rows, err)
}
func scanNotes(rows pgx.Rows, err error) ([]note, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []note{}
	for rows.Next() {
		var n note
		if err = rows.Scan(&n.id, &n.revision); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
func (s *Service) notify(notes []note) {
	if s.notifier != nil {
		for _, n := range notes {
			s.notifier.ConfigChanged(n.id, n.revision)
		}
	}
}
func (s *Service) audit(ctx context.Context, tx pgx.Tx, user uuid.UUID, action, resource string, id uuid.UUID, values map[string]any, revision int64) {
	metadata, _ := json.Marshal(map[string]any{"changedKeys": sortedKeys(values), "revision": revision, "scope": resource})
	_, _ = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata)VALUES($1,$2,$3,$4,$5,$6)`, uuid.New(), user, action, resource, id.String(), metadata)
}
func mergeDefaults(values map[string]any, scope Scope) map[string]any {
	out := Defaults(scope)
	for key, value := range values {
		out[key] = value
	}
	return out
}
func filterDefinitions(scope Scope) []Definition {
	out := []Definition{}
	for _, d := range definitions {
		if d.Scope == scope {
			out = append(out, d)
		}
	}
	return out
}
func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
func (s *Service) hardLimits(v map[string]any) error {
	checks := []struct {
		key string
		max float64
	}{{"media.upload.max_bytes", float64(s.limits.MaxUploadBytes)}, {"emergency.maximum_duration_minutes", float64(s.limits.MaxEmergencyMinutes)}, {"website.default_timeout_seconds", float64(s.limits.MaxWebsiteTimeout)}, {"scheduling.prefetch_days", float64(s.limits.MaxPrefetchDays)}}
	for _, c := range checks {
		if n, ok := v[c.key].(float64); ok && c.max > 0 && n > c.max {
			return fmt.Errorf("setting_exceeds_hard_limit: %s", c.key)
		}
	}
	if enabled, _ := v["website.private_http_enabled"].(bool); enabled && !s.limits.PrivateHTTPAllowed {
		return errors.New("setting_exceeds_hard_limit: private HTTP is disabled at deployment")
	}
	if defaultDuration, ok := v["emergency.default_duration_minutes"].(float64); ok {
		if maximum, ok := v["emergency.maximum_duration_minutes"].(float64); ok && defaultDuration > maximum {
			return errors.New("invalid_setting_value: default emergency duration exceeds maximum")
		}
	}
	return nil
}
func (s *Service) validateBranding(ctx context.Context, v map[string]any) error {
	background, _ := v["branding.player_background_color"].(string)
	textColor, _ := v["branding.player_text_color"].(string)
	if background != "" && textColor != "" && contrast(background, textColor) < 4.5 {
		return errors.New("invalid_setting_value: player text and background colors need at least 4.5:1 contrast")
	}
	for _, key := range []string{"branding.logo_asset_id", "branding.icon_asset_id"} {
		value, _ := v[key].(string)
		if value == "" {
			continue
		}
		id, err := uuid.Parse(value)
		if err != nil {
			return errors.New("branding_asset_invalid")
		}
		var valid bool
		_ = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id=$1 AND type='image' AND processing_status='ready' AND deleted_at IS NULL)`, id).Scan(&valid)
		if !valid {
			return errors.New("branding_asset_invalid")
		}
	}
	return nil
}
func contrast(a, b string) float64 {
	la, lb := luminance(a), luminance(b)
	if la < lb {
		la, lb = lb, la
	}
	return (la + .05) / (lb + .05)
}
func luminance(color string) float64 {
	if len(color) != 7 {
		return 0
	}
	channels := []float64{}
	for i := 1; i < 7; i += 2 {
		value, _ := strconv.ParseUint(color[i:i+2], 16, 8)
		c := float64(value) / 255
		if c <= .03928 {
			c /= 12.92
		} else {
			c = pow((c+.055)/1.055, 2.4)
		}
		channels = append(channels, c)
	}
	return .2126*channels[0] + .7152*channels[1] + .0722*channels[2]
}
func pow(x, y float64) float64 { return math.Pow(x, y) }
