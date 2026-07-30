// Package notify delivers operational conditions to people who are not
// looking at Studio.
//
// The design rule that shapes everything here: notification volume is
// inherited from the incident model, never invented. An incident opens once,
// absorbs repeats, and recovers, so a screen that flaps ten times produces two
// messages -- opened and recovered -- not ten. Anything that would send per
// event belongs in Activity, not in this package.
package notify

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Categories a subscriber can turn on independently. Adding one means adding
// the matching preference key in the settings registry; an event carrying an
// unknown category is dropped rather than sent to everyone.
const (
	CategoryIncident      = "incident"
	CategoryContentHealth = "content_health"
	CategoryBackup        = "backup"
	CategoryUpdate        = "update"
)

// Severity ordering. Only the minimum-severity comparison depends on this, but
// it must match the incidents table CHECK constraint.
var severityRank = map[string]int{"info": 0, "warning": 1, "error": 2, "critical": 3}

// SeverityAtLeast reports whether severity meets the configured floor. An
// unrecognised severity is treated as the floor's equal so a new severity
// added elsewhere fails loud in tests rather than silently muting alerts.
func SeverityAtLeast(severity, minimum string) bool {
	return severityRank[severity] >= severityRank[minimum]
}

// Event is one thing worth telling somebody about.
type Event struct {
	// Key identifies the transition and nothing else -- "incident:<id>:opened".
	// It is the idempotency key for the whole delivery fan-out, so it must be
	// stable across worker restarts and must never include a timestamp.
	Key        string
	Category   string
	Severity   string
	Subject    string
	Body       string
	OccurredAt time.Time
	// Payload is the webhook body. It must not contain credentials, device
	// secrets, or anything that would be unsafe in a third-party chat relay.
	Payload map[string]any
	// URL is the Studio page that shows the condition, included in email so a
	// recipient can act rather than go hunting.
	URL string
	// FloorSeverity is what the minimum-severity setting is compared against,
	// when that differs from how the message presents. A recovery presents as
	// info -- nobody should be woken to be told a screen came back -- but it
	// must reach whoever was told the condition started, so it is tested at
	// the severity of the condition it closes. Empty means use Severity.
	FloorSeverity string
}

// Config carries deployment-level notification settings. SMTP credentials are
// environment configuration rather than database settings on purpose: a
// password stored through Studio would be a recoverable secret in the schema
// and would appear in every backup and export.
type Config struct {
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	// starttls (default), implicit, or none. "none" is allowed because a
	// self-hosted installation is often relaying through localhost.
	SMTPTLS            string
	SMTPTimeout        time.Duration
	SMTPAllowInsecure  bool
	PublicURL          string
	MaxAttempts        int
	WebhookTimeout     time.Duration
	MaxWebhooksPerOrg  int
	MaxDeliveryBodyLen int
}

// EmailConfigured reports whether this installation can send email at all.
// When it cannot, notifications are simply off: nothing fails, no delivery row
// is written, and Studio says why.
func (c Config) EmailConfigured() bool { return strings.TrimSpace(c.SMTPHost) != "" }

// DefaultConfig fills the values that are not deployment-specific.
func DefaultConfig() Config {
	return Config{
		SMTPPort:           587,
		SMTPTLS:            "starttls",
		SMTPTimeout:        20 * time.Second,
		MaxAttempts:        6,
		WebhookTimeout:     15 * time.Second,
		MaxWebhooksPerOrg:  20,
		MaxDeliveryBodyLen: 16384,
	}
}

// Settings is the organization-level notification policy, parsed from the
// settings registry.
type Settings struct {
	Enabled           bool
	FromAddress       string
	FromName          string
	MinimumSeverity   string
	DigestHour        int
	DigestMinute      int
	Location          *time.Location
	QuietHoursEnabled bool
	QuietStartMinutes int
	QuietEndMinutes   int
	RetentionDays     int
}

// ParseSettings reads the notifications.* organization values. Missing keys
// fall back to registry defaults so an installation that has never opened the
// settings page behaves predictably.
func ParseSettings(values map[string]any) (Settings, error) {
	s := Settings{
		Enabled:           boolSetting(values, "notifications.enabled", false),
		FromAddress:       strings.TrimSpace(stringSetting(values, "notifications.from_address", "")),
		FromName:          stringSetting(values, "notifications.from_name", "Tilecast"),
		MinimumSeverity:   stringSetting(values, "notifications.minimum_severity", "warning"),
		QuietHoursEnabled: boolSetting(values, "notifications.quiet_hours_enabled", false),
		RetentionDays:     intSetting(values, "notifications.retention_days", 90),
	}
	if _, ok := severityRank[s.MinimumSeverity]; !ok {
		s.MinimumSeverity = "warning"
	}
	location, err := time.LoadLocation(stringSetting(values, "notifications.timezone", "UTC"))
	if err != nil {
		// A timezone database that cannot resolve the configured zone must not
		// stop notifications; UTC delivery is better than silence.
		location = time.UTC
	}
	s.Location = location

	digest, err := parseClock(stringSetting(values, "notifications.digest_time", "07:30"))
	if err != nil {
		return Settings{}, fmt.Errorf("notifications.digest_time: %w", err)
	}
	s.DigestHour, s.DigestMinute = digest/60, digest%60

	start, err := parseClock(stringSetting(values, "notifications.quiet_hours_start", "20:00"))
	if err != nil {
		return Settings{}, fmt.Errorf("notifications.quiet_hours_start: %w", err)
	}
	end, err := parseClock(stringSetting(values, "notifications.quiet_hours_end", "06:30"))
	if err != nil {
		return Settings{}, fmt.Errorf("notifications.quiet_hours_end: %w", err)
	}
	s.QuietStartMinutes, s.QuietEndMinutes = start, end
	return s, nil
}

// InQuietHours reports whether the instant falls inside the configured quiet
// window, which normally wraps midnight.
func (s Settings) InQuietHours(at time.Time) bool {
	if !s.QuietHoursEnabled || s.QuietStartMinutes == s.QuietEndMinutes {
		return false
	}
	local := at.In(s.Location)
	minutes := local.Hour()*60 + local.Minute()
	if s.QuietStartMinutes < s.QuietEndMinutes {
		return minutes >= s.QuietStartMinutes && minutes < s.QuietEndMinutes
	}
	return minutes >= s.QuietStartMinutes || minutes < s.QuietEndMinutes
}

// QuietHoursEnd returns the next instant at which quiet hours are over.
func (s Settings) QuietHoursEnd(at time.Time) time.Time {
	local := at.In(s.Location)
	end := time.Date(local.Year(), local.Month(), local.Day(), s.QuietEndMinutes/60, s.QuietEndMinutes%60, 0, 0, s.Location)
	if !end.After(local) {
		end = end.AddDate(0, 0, 1)
	}
	return end
}

// NextDigest returns the next digest instant after the given time.
func (s Settings) NextDigest(at time.Time) time.Time {
	local := at.In(s.Location)
	next := time.Date(local.Year(), local.Month(), local.Day(), s.DigestHour, s.DigestMinute, 0, 0, s.Location)
	if !next.After(local) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

// ScheduleFor decides when a delivery for this subscriber should be attempted.
// Critical conditions ignore quiet hours and the digest: an installation that
// held a safe-mode notification until morning would be actively harmful.
func (s Settings) ScheduleFor(mode, severity string, now time.Time) time.Time {
	if severity == "critical" {
		return now
	}
	if mode == "digest" {
		return s.NextDigest(now)
	}
	if s.InQuietHours(now) {
		return s.QuietHoursEnd(now)
	}
	return now
}

// Backoff is the delay before retrying a failed delivery. A mail server that
// is down during a site-wide outage would otherwise be retried in lockstep
// with every other delivery the outage produced.
func Backoff(attempts int) time.Duration {
	if attempts < 1 {
		attempts = 1
	}
	if attempts > 6 {
		attempts = 6
	}
	return time.Duration(1<<uint(attempts-1)) * time.Minute
}

var errClock = errors.New("expected HH:MM")

func parseClock(value string) (int, error) {
	parts := strings.SplitN(strings.TrimSpace(value), ":", 3)
	if len(parts) < 2 {
		return 0, errClock
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil || hour < 0 || hour > 23 {
		return 0, errClock
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil || minute < 0 || minute > 59 {
		return 0, errClock
	}
	return hour*60 + minute, nil
}

func boolSetting(values map[string]any, key string, fallback bool) bool {
	if v, ok := values[key].(bool); ok {
		return v
	}
	return fallback
}

func stringSetting(values map[string]any, key, fallback string) string {
	if v, ok := values[key].(string); ok && v != "" {
		return v
	}
	return fallback
}

func intSetting(values map[string]any, key string, fallback int) int {
	switch v := values[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	}
	return fallback
}

// truncate keeps stored bodies bounded. A failure message from a player or an
// upstream feed is attacker-influenced in the sense that it is not authored
// here, so it never sets the size of a database row.
func truncate(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	// Cut on a rune boundary. Slicing by byte can split a multi-byte character,
	// and the result is stored in a UTF-8 column, so the insert would fail
	// rather than merely look wrong.
	for limit > 0 && !utf8.RuneStart(value[limit]) {
		limit--
	}
	return value[:limit] + "\n[truncated]"
}

// ctxWithTimeout is a small helper so senders cannot inherit an unbounded
// context from the worker loop.
func ctxWithTimeout(ctx context.Context, d time.Duration) (context.Context, context.CancelFunc) {
	if d <= 0 {
		d = 20 * time.Second
	}
	return context.WithTimeout(ctx, d)
}
