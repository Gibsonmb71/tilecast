package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

const nwsAlertsURL = "https://api.weather.gov/alerts/active"

var ErrValidation = errors.New("alert validation failed")

type alertValidationError struct{ message string }

func (e alertValidationError) Error() string { return e.message }
func (e alertValidationError) Unwrap() error { return ErrValidation }

func validationError(message string, args ...any) error {
	return alertValidationError{message: fmt.Sprintf(message, args...)}
}

type Monitor struct {
	Enabled             bool       `json:"enabled"`
	Areas               []string   `json:"areas"`
	Zones               []string   `json:"zones"`
	PollIntervalSeconds int        `json:"pollIntervalSeconds"`
	LastPolledAt        *time.Time `json:"lastPolledAt,omitempty"`
	LastSuccessAt       *time.Time `json:"lastSuccessAt,omitempty"`
	LastErrorCode       string     `json:"lastErrorCode,omitempty"`
	LastMatchedCount    int        `json:"lastMatchedCount"`
	UpdatedAt           time.Time  `json:"updatedAt"`
}

type Rule struct {
	ID                     uuid.UUID   `json:"id"`
	Name                   string      `json:"name"`
	Enabled                bool        `json:"enabled"`
	EventNames             []string    `json:"eventNames"`
	MinimumSeverity        string      `json:"minimumSeverity"`
	MinimumUrgency         string      `json:"minimumUrgency"`
	PlaylistID             *uuid.UUID  `json:"playlistId,omitempty"`
	PlaylistName           string      `json:"playlistName,omitempty"`
	MaximumDurationMinutes int         `json:"maximumDurationMinutes"`
	ScreenIDs              []uuid.UUID `json:"screenIds"`
	GroupIDs               []uuid.UUID `json:"groupIds"`
	CreatedAt              time.Time   `json:"createdAt"`
	UpdatedAt              time.Time   `json:"updatedAt"`
}

type RuleInput struct {
	Name                   string      `json:"name"`
	Enabled                bool        `json:"enabled"`
	EventNames             []string    `json:"eventNames"`
	MinimumSeverity        string      `json:"minimumSeverity"`
	MinimumUrgency         string      `json:"minimumUrgency"`
	PlaylistID             *uuid.UUID  `json:"playlistId"`
	MaximumDurationMinutes int         `json:"maximumDurationMinutes"`
	ScreenIDs              []uuid.UUID `json:"screenIds"`
	GroupIDs               []uuid.UUID `json:"groupIds"`
}

type Activation struct {
	AlertID         string     `json:"alertId"`
	RuleID          uuid.UUID  `json:"ruleId"`
	RuleName        string     `json:"ruleName"`
	Event           string     `json:"event"`
	Headline        string     `json:"headline"`
	Severity        string     `json:"severity"`
	Urgency         string     `json:"urgency"`
	AreaDescription string     `json:"areaDescription"`
	ExpiresAt       *time.Time `json:"expiresAt,omitempty"`
	TakeoverID      *uuid.UUID `json:"takeoverId,omitempty"`
	FirstSeenAt     time.Time  `json:"firstSeenAt"`
	LastSeenAt      time.Time  `json:"lastSeenAt"`
}

type Service struct {
	db          *pgxpool.Pool
	devices     *devices.Service
	playlists   *playlists.Service
	client      *http.Client
	baseURL     string
	logger      *slog.Logger
	userAgent   string
	maxDuration time.Duration
	gate        func() bool
	cancel      context.CancelFunc
	done        chan struct{}
	mu          sync.Mutex
}

func NewService(db *pgxpool.Pool, deviceService *devices.Service, playlistService *playlists.Service, logger *slog.Logger, publicURL string, maxDuration time.Duration) *Service {
	contact := strings.TrimSpace(publicURL)
	if contact == "" {
		contact = "self-hosted Tilecast installation"
	}
	return &Service{
		db: db, devices: deviceService, playlists: playlistService, logger: logger,
		client:      &http.Client{Timeout: 20 * time.Second},
		baseURL:     nwsAlertsURL,
		userAgent:   "Tilecast/1.0 (" + contact + ")",
		maxDuration: maxDuration,
		done:        make(chan struct{}),
	}
}

func (s *Service) SetGate(gate func() bool) { s.gate = gate }

func (s *Service) Start(parent context.Context) {
	s.mu.Lock()
	if s.cancel != nil {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	s.done = make(chan struct{})
	done := s.done
	s.mu.Unlock()
	go func() {
		defer func() {
			s.mu.Lock()
			if s.done == done {
				s.cancel = nil
			}
			close(done)
			s.mu.Unlock()
		}()
		timer := time.NewTimer(5 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				monitor, err := s.Monitor(ctx)
				if err == nil && monitor.Enabled && (s.gate == nil || s.gate()) {
					if err = s.Poll(ctx); err != nil && s.logger != nil {
						s.logger.Warn("NWS alert poll failed", "error", err)
					}
				}
				delay := 2 * time.Minute
				if monitor.PollIntervalSeconds >= 60 {
					delay = time.Duration(monitor.PollIntervalSeconds) * time.Second
				}
				timer.Reset(delay)
			}
		}
	}()
}

func (s *Service) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	done := s.done
	s.mu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	<-done
}

func (s *Service) Monitor(ctx context.Context) (Monitor, error) {
	var result Monitor
	err := s.db.QueryRow(ctx, `SELECT enabled,areas,zones,poll_interval_seconds,last_polled_at,last_success_at,COALESCE(last_error_code,''),last_matched_count,updated_at FROM alert_monitor WHERE singleton`).Scan(
		&result.Enabled, &result.Areas, &result.Zones, &result.PollIntervalSeconds, &result.LastPolledAt, &result.LastSuccessAt, &result.LastErrorCode, &result.LastMatchedCount, &result.UpdatedAt,
	)
	return result, err
}

func (s *Service) UpdateMonitor(ctx context.Context, enabled bool, areas, zones []string, interval int, userID uuid.UUID) (Monitor, error) {
	areas, err := normalizeCodes(areas, 2, "area")
	if err != nil {
		return Monitor{}, validationError("%v", err)
	}
	zones, err = normalizeCodes(zones, 6, "zone")
	if err != nil {
		return Monitor{}, validationError("%v", err)
	}
	if interval < 60 || interval > 3600 {
		return Monitor{}, validationError("poll interval must be between 60 and 3600 seconds")
	}
	if enabled && len(areas)+len(zones) == 0 {
		return Monitor{}, validationError("select at least one state, territory, county, or forecast zone")
	}
	_, err = s.db.Exec(ctx, `UPDATE alert_monitor SET enabled=$1,areas=$2,zones=$3,poll_interval_seconds=$4,updated_by=$5,updated_at=now() WHERE singleton`, enabled, areas, zones, interval, userID)
	if err != nil {
		return Monitor{}, err
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,metadata) VALUES($1,$2,'nws_monitor.updated','nws_alert_monitor','singleton',jsonb_build_object('enabled',$3,'areas',$4,'zones',$5))`, uuid.New(), userID, enabled, areas, zones)
	return s.Monitor(ctx)
}

func normalizeCodes(values []string, length int, label string) ([]string, error) {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToUpper(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		if len(value) != length {
			return nil, fmt.Errorf("%s code %q must be %d characters", label, value, length)
		}
		for _, char := range value {
			if (char < 'A' || char > 'Z') && (char < '0' || char > '9') {
				return nil, fmt.Errorf("%s code %q is invalid", label, value)
			}
		}
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result, nil
}

func (s *Service) Rules(ctx context.Context) ([]Rule, error) {
	rows, err := s.db.Query(ctx, `SELECT r.id,r.name,r.enabled,r.event_names,r.minimum_severity,r.minimum_urgency,r.playlist_id,COALESCE(p.name,''),r.maximum_duration_minutes,r.created_at,r.updated_at,
		COALESCE(array_agg(t.screen_id) FILTER (WHERE t.screen_id IS NOT NULL),'{}'),COALESCE(array_agg(t.screen_group_id) FILTER (WHERE t.screen_group_id IS NOT NULL),'{}')
		FROM alert_rules r LEFT JOIN playlists p ON p.id=r.playlist_id LEFT JOIN alert_rule_targets t ON t.rule_id=r.id
		GROUP BY r.id,p.name ORDER BY r.position,r.name,r.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Rule{}
	for rows.Next() {
		var rule Rule
		if err = rows.Scan(&rule.ID, &rule.Name, &rule.Enabled, &rule.EventNames, &rule.MinimumSeverity, &rule.MinimumUrgency, &rule.PlaylistID, &rule.PlaylistName, &rule.MaximumDurationMinutes, &rule.CreatedAt, &rule.UpdatedAt, &rule.ScreenIDs, &rule.GroupIDs); err != nil {
			return nil, err
		}
		result = append(result, rule)
	}
	return result, rows.Err()
}

func (s *Service) SaveRule(ctx context.Context, id uuid.UUID, input RuleInput, userID uuid.UUID) (Rule, error) {
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 180 {
		return Rule{}, validationError("rule name is required and must be at most 180 characters")
	}
	if !rankContains(severityRank, input.MinimumSeverity) || !rankContains(urgencyRank, input.MinimumUrgency) {
		return Rule{}, validationError("severity or urgency is invalid")
	}
	if input.PlaylistID == nil || *input.PlaylistID == uuid.Nil {
		return Rule{}, validationError("select a takeover playlist")
	}
	if input.MaximumDurationMinutes < 5 || input.MaximumDurationMinutes > int(s.maxDuration/time.Minute) {
		return Rule{}, validationError("maximum duration must be between 5 and %d minutes", int(s.maxDuration/time.Minute))
	}
	if len(input.ScreenIDs)+len(input.GroupIDs) == 0 {
		return Rule{}, validationError("select at least one screen or group")
	}
	events := make([]string, 0, len(input.EventNames))
	for _, event := range input.EventNames {
		event = strings.TrimSpace(event)
		if event != "" && len(event) <= 120 {
			events = append(events, event)
		}
	}
	var organizationID uuid.UUID
	var ready bool
	err := s.db.QueryRow(ctx, `SELECT organization_id,(deleted_at IS NULL AND EXISTS(SELECT 1 FROM playlist_items WHERE playlist_id=playlists.id)) FROM playlists WHERE id=$1`, *input.PlaylistID).Scan(&organizationID, &ready)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !ready {
		return Rule{}, validationError("select a ready, non-empty playlist")
	}
	if err != nil {
		return Rule{}, err
	}
	if err = s.playlists.ValidatePresentationTargets(ctx, input.PlaylistID, nil, input.ScreenIDs, input.GroupIDs); err != nil {
		if errors.Is(err, playlists.ErrConflict) {
			return Rule{}, validationError("%v", err)
		}
		return Rule{}, err
	}
	creating := id == uuid.Nil
	if creating {
		id = uuid.New()
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Rule{}, err
	}
	defer tx.Rollback(ctx)
	var tag pgconn.CommandTag
	if creating {
		tag, err = tx.Exec(ctx, `INSERT INTO alert_rules(id,organization_id,name,enabled,event_names,minimum_severity,minimum_urgency,response_mode,playlist_id,maximum_duration_minutes,created_by)
			VALUES($1,$2,$3,$4,$5,$6,$7,'takeover',$8,$9,$10)`,
			id, organizationID, input.Name, input.Enabled, events, input.MinimumSeverity, input.MinimumUrgency, input.PlaylistID, input.MaximumDurationMinutes, userID)
	} else {
		tag, err = tx.Exec(ctx, `UPDATE alert_rules SET name=$3,enabled=$4,event_names=$5,minimum_severity=$6,minimum_urgency=$7,playlist_id=$8,maximum_duration_minutes=$9,updated_at=now()
			WHERE id=$1 AND organization_id=$2`,
			id, organizationID, input.Name, input.Enabled, events, input.MinimumSeverity, input.MinimumUrgency, input.PlaylistID, input.MaximumDurationMinutes)
	}
	if err != nil {
		return Rule{}, err
	}
	if tag.RowsAffected() == 0 {
		return Rule{}, pgx.ErrNoRows
	}
	if _, err = tx.Exec(ctx, `DELETE FROM alert_rule_targets WHERE rule_id=$1`, id); err != nil {
		return Rule{}, err
	}
	for _, screenID := range uniqueUUIDs(input.ScreenIDs) {
		if _, err = tx.Exec(ctx, `INSERT INTO alert_rule_targets(rule_id,target_type,screen_id) SELECT $1,'screen',$2 WHERE EXISTS(SELECT 1 FROM screens WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL)`, id, screenID, organizationID); err != nil {
			return Rule{}, err
		}
	}
	for _, groupID := range uniqueUUIDs(input.GroupIDs) {
		if _, err = tx.Exec(ctx, `INSERT INTO alert_rule_targets(rule_id,target_type,screen_group_id) SELECT $1,'group',$2 WHERE EXISTS(SELECT 1 FROM screen_groups WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL)`, id, groupID, organizationID); err != nil {
			return Rule{}, err
		}
	}
	_, _ = tx.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'nws_alert_rule.saved','nws_alert_rule',$3)`, uuid.New(), userID, id.String())
	if err = tx.Commit(ctx); err != nil {
		return Rule{}, err
	}
	rules, err := s.Rules(ctx)
	if err != nil {
		return Rule{}, err
	}
	for _, rule := range rules {
		if rule.ID == id {
			return rule, nil
		}
	}
	return Rule{}, pgx.ErrNoRows
}

func (s *Service) DeleteRule(ctx context.Context, id, userID uuid.UUID) error {
	rows, err := s.db.Query(ctx, `SELECT takeover_id FROM alert_activations WHERE rule_id=$1 AND cleared_at IS NULL AND takeover_id IS NOT NULL`, id)
	if err != nil {
		return err
	}
	takeoverIDs := []uuid.UUID{}
	for rows.Next() {
		var takeoverID uuid.UUID
		if rows.Scan(&takeoverID) == nil {
			takeoverIDs = append(takeoverIDs, takeoverID)
		}
	}
	rows.Close()
	for _, takeoverID := range takeoverIDs {
		if err = s.cancelTakeover(ctx, takeoverID, time.Now().UTC()); err != nil {
			return err
		}
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM alert_rules WHERE id=$1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	_, _ = s.db.Exec(ctx, `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id) VALUES($1,$2,'nws_alert_rule.deleted','nws_alert_rule',$3)`, uuid.New(), userID, id.String())
	return nil
}

func (s *Service) Activations(ctx context.Context) ([]Activation, error) {
	rows, err := s.db.Query(ctx, `SELECT a.alert_id,a.rule_id,r.name,a.event,a.headline,a.severity,a.urgency,a.area_description,a.expires_at,a.takeover_id,a.first_seen_at,a.last_seen_at
		FROM alert_activations a JOIN alert_rules r ON r.id=a.rule_id WHERE a.cleared_at IS NULL ORDER BY a.first_seen_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Activation{}
	for rows.Next() {
		var item Activation
		if err = rows.Scan(&item.AlertID, &item.RuleID, &item.RuleName, &item.Event, &item.Headline, &item.Severity, &item.Urgency, &item.AreaDescription, &item.ExpiresAt, &item.TakeoverID, &item.FirstSeenAt, &item.LastSeenAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

type nwsCollection struct {
	Features []struct {
		ID         string        `json:"id"`
		Properties nwsProperties `json:"properties"`
	} `json:"features"`
}

type nwsProperties struct {
	ID              string     `json:"id"`
	Event           string     `json:"event"`
	Headline        string     `json:"headline"`
	Description     string     `json:"description"`
	Instruction     string     `json:"instruction"`
	Severity        string     `json:"severity"`
	Urgency         string     `json:"urgency"`
	Certainty       string     `json:"certainty"`
	AreaDescription string     `json:"areaDesc"`
	SenderName      string     `json:"senderName"`
	Effective       *time.Time `json:"effective"`
	Expires         *time.Time `json:"expires"`
	Ends            *time.Time `json:"ends"`
	Status          string     `json:"status"`
	MessageType     string     `json:"messageType"`
}

func (s *Service) Poll(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	monitor, err := s.Monitor(ctx)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	_, _ = s.db.Exec(ctx, `UPDATE alert_monitor SET last_polled_at=$1 WHERE singleton`, now)
	var collection nwsCollection
	// Area and zone are separate NWS query dimensions. Fetch them separately
	// and union by alert identifier; sending both in one request would mean an
	// intersection and could silently omit a configured county.
	scopes := [][2]string{}
	if len(monitor.Areas) > 0 {
		scopes = append(scopes, [2]string{"area", strings.Join(monitor.Areas, ",")})
	}
	if len(monitor.Zones) > 0 {
		scopes = append(scopes, [2]string{"zone", strings.Join(monitor.Zones, ",")})
	}
	if len(scopes) == 0 {
		scopes = append(scopes, [2]string{})
	}
	featureIDs := map[string]bool{}
	for _, scope := range scopes {
		part, fetchErr := s.fetch(ctx, scope[0], scope[1])
		if fetchErr != nil {
			return fetchErr
		}
		for _, feature := range part.Features {
			id := feature.Properties.ID
			if id == "" {
				id = feature.ID
			}
			if !featureIDs[id] {
				featureIDs[id] = true
				collection.Features = append(collection.Features, feature)
			}
		}
	}
	rules, err := s.Rules(ctx)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	matched := 0
	var applyErr error
	for _, feature := range collection.Features {
		if !nwsAlertActive(feature.Properties, now) {
			continue
		}
		alertID := strings.TrimSpace(feature.Properties.ID)
		if alertID == "" {
			alertID = strings.TrimSpace(feature.ID)
		}
		if alertID == "" {
			continue
		}
		for _, rule := range rules {
			if !rule.Enabled || !matches(rule, feature.Properties.Event, feature.Properties.Severity, feature.Properties.Urgency) {
				continue
			}
			key := alertID + "\x00" + rule.ID.String()
			seen[key] = true
			matched++
			if err = s.applyAlert(ctx, alertID, rule, feature.Properties, now); err != nil {
				if applyErr == nil {
					applyErr = err
				}
				if s.logger != nil {
					s.logger.Error("apply NWS alert failed", "rule_id", rule.ID, "error", err)
				}
			}
		}
	}
	if err = s.clearMissing(ctx, seen, now); err != nil {
		return err
	}
	if applyErr != nil {
		_, err = s.db.Exec(ctx, `UPDATE alert_monitor SET last_error_code='alert_apply_failed',last_matched_count=$1 WHERE singleton`, matched)
	} else {
		_, err = s.db.Exec(ctx, `UPDATE alert_monitor SET last_success_at=$1,last_error_code=NULL,last_matched_count=$2 WHERE singleton`, now, matched)
	}
	if err == nil && applyErr != nil {
		return fmt.Errorf("apply one or more NWS alert rules: %w", applyErr)
	}
	return err
}

func nwsAlertActive(alert nwsProperties, now time.Time) bool {
	end := alert.Expires
	if alert.Ends != nil {
		end = alert.Ends
	}
	return end == nil || end.After(now)
}

func (s *Service) fetch(ctx context.Context, filter, value string) (nwsCollection, error) {
	requestURL, err := url.Parse(s.baseURL)
	if err != nil {
		return nwsCollection{}, fmt.Errorf("parse NWS base URL: %w", err)
	}
	query := requestURL.Query()
	if filter != "" {
		query.Set(filter, value)
	}
	query.Set("status", "actual")
	query.Set("message_type", "alert")
	requestURL.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nwsCollection{}, fmt.Errorf("create NWS request: %w", err)
	}
	req.Header.Set("Accept", "application/geo+json")
	req.Header.Set("User-Agent", s.userAgent)
	response, err := s.client.Do(req)
	if err != nil {
		s.recordPollFailure(ctx, "nws_unreachable")
		return nwsCollection{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		s.recordPollFailure(ctx, fmt.Sprintf("nws_http_%d", response.StatusCode))
		return nwsCollection{}, fmt.Errorf("NWS returned HTTP %d", response.StatusCode)
	}
	var collection nwsCollection
	if err = json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&collection); err != nil {
		s.recordPollFailure(ctx, "nws_invalid_response")
		return nwsCollection{}, err
	}
	return collection, nil
}

func (s *Service) recordPollFailure(ctx context.Context, code string) {
	_, _ = s.db.Exec(ctx, `UPDATE alert_monitor SET last_error_code=$1 WHERE singleton`, code)
}

func matches(rule Rule, event, severity, urgency string) bool {
	if severityRank[severity] < severityRank[rule.MinimumSeverity] || urgencyRank[urgency] < urgencyRank[rule.MinimumUrgency] {
		return false
	}
	if len(rule.EventNames) == 0 {
		return true
	}
	for _, name := range rule.EventNames {
		if strings.EqualFold(strings.TrimSpace(name), strings.TrimSpace(event)) {
			return true
		}
	}
	return false
}

var severityRank = map[string]int{"Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4}
var urgencyRank = map[string]int{"Unknown": 0, "Future": 1, "Expected": 2, "Immediate": 3}

func rankContains(values map[string]int, value string) bool {
	_, ok := values[value]
	return ok
}

func uniqueUUIDs(values []uuid.UUID) []uuid.UUID {
	seen := map[uuid.UUID]bool{}
	result := []uuid.UUID{}
	for _, value := range values {
		if value != uuid.Nil && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}
