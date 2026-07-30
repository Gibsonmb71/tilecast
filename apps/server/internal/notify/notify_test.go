package notify

import (
	"net/mail"
	"strings"
	"testing"
	"time"
)

func testSettings(t *testing.T, values map[string]any) Settings {
	t.Helper()
	parsed, err := ParseSettings(values)
	if err != nil {
		t.Fatalf("ParseSettings: %v", err)
	}
	return parsed
}

func TestParseSettingsUsesRegistryDefaults(t *testing.T) {
	s := testSettings(t, map[string]any{})
	if s.Enabled {
		t.Error("notifications must be off until an administrator turns them on")
	}
	if s.MinimumSeverity != "warning" {
		t.Errorf("minimum severity = %q, want warning", s.MinimumSeverity)
	}
	if s.DigestHour != 7 || s.DigestMinute != 30 {
		t.Errorf("digest = %02d:%02d, want 07:30", s.DigestHour, s.DigestMinute)
	}
}

func TestParseSettingsFallsBackToUTCOnUnknownZone(t *testing.T) {
	// A missing zoneinfo database must not stop delivery.
	s := testSettings(t, map[string]any{"notifications.timezone": "Mars/Olympus"})
	if s.Location != time.UTC {
		t.Errorf("location = %v, want UTC", s.Location)
	}
}

func TestQuietHoursWrapMidnight(t *testing.T) {
	s := testSettings(t, map[string]any{
		"notifications.quiet_hours_enabled": true,
		"notifications.quiet_hours_start":   "20:00",
		"notifications.quiet_hours_end":     "06:30",
	})
	cases := []struct {
		hour, minute int
		quiet        bool
	}{
		{21, 0, true}, {2, 0, true}, {6, 29, true},
		{6, 30, false}, {12, 0, false}, {19, 59, false}, {20, 0, true},
	}
	for _, c := range cases {
		at := time.Date(2026, 3, 4, c.hour, c.minute, 0, 0, time.UTC)
		if got := s.InQuietHours(at); got != c.quiet {
			t.Errorf("InQuietHours(%02d:%02d) = %v, want %v", c.hour, c.minute, got, c.quiet)
		}
	}
}

func TestQuietHoursDisabledByDefault(t *testing.T) {
	s := testSettings(t, map[string]any{})
	if s.InQuietHours(time.Date(2026, 3, 4, 3, 0, 0, 0, time.UTC)) {
		t.Error("quiet hours must not apply unless enabled")
	}
}

func TestCriticalIgnoresQuietHoursAndDigest(t *testing.T) {
	s := testSettings(t, map[string]any{
		"notifications.quiet_hours_enabled": true,
		"notifications.quiet_hours_start":   "20:00",
		"notifications.quiet_hours_end":     "06:30",
	})
	now := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	if got := s.ScheduleFor("digest", "critical", now); !got.Equal(now) {
		t.Errorf("critical scheduled at %v, want immediate %v", got, now)
	}
	if got := s.ScheduleFor("immediate", "critical", now); !got.Equal(now) {
		t.Errorf("critical held by quiet hours: %v", got)
	}
}

func TestWarningIsHeldUntilQuietHoursEnd(t *testing.T) {
	s := testSettings(t, map[string]any{
		"notifications.quiet_hours_enabled": true,
		"notifications.quiet_hours_start":   "20:00",
		"notifications.quiet_hours_end":     "06:30",
	})
	now := time.Date(2026, 3, 4, 23, 0, 0, 0, time.UTC)
	got := s.ScheduleFor("immediate", "warning", now)
	want := time.Date(2026, 3, 5, 6, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("held until %v, want %v", got, want)
	}
}

func TestDigestSchedulesForNextDigestTime(t *testing.T) {
	s := testSettings(t, map[string]any{"notifications.digest_time": "07:30"})
	now := time.Date(2026, 3, 4, 9, 0, 0, 0, time.UTC)
	got := s.ScheduleFor("digest", "error", now)
	want := time.Date(2026, 3, 5, 7, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("digest at %v, want %v", got, want)
	}
}

func TestSeverityFloor(t *testing.T) {
	if SeverityAtLeast("info", "warning") {
		t.Error("info must not pass a warning floor")
	}
	if !SeverityAtLeast("critical", "warning") {
		t.Error("critical must pass a warning floor")
	}
	if !SeverityAtLeast("warning", "warning") {
		t.Error("the floor itself must pass")
	}
}

func TestBackoffGrowsAndIsCapped(t *testing.T) {
	if Backoff(1) != time.Minute {
		t.Errorf("first retry = %v, want 1m", Backoff(1))
	}
	if Backoff(3) != 4*time.Minute {
		t.Errorf("third retry = %v, want 4m", Backoff(3))
	}
	if Backoff(99) != Backoff(6) {
		t.Error("backoff must be capped so a dead relay does not schedule retries in the far future")
	}
}

func TestSignIsStableAndCoversTheTimestamp(t *testing.T) {
	body := []byte(`{"event":"incident:1:opened"}`)
	first := Sign("whsec_test", 1772000000, body)
	if first != Sign("whsec_test", 1772000000, body) {
		t.Error("signature must be deterministic")
	}
	if first == Sign("whsec_test", 1772000001, body) {
		t.Error("a replayed body with a fresh timestamp must not verify")
	}
	if first == Sign("whsec_other", 1772000000, body) {
		t.Error("a different secret must produce a different signature")
	}
	if !strings.HasPrefix(first, "sha256=") {
		t.Errorf("signature = %q, want a sha256= prefix", first)
	}
}

func TestValidateWebhookURL(t *testing.T) {
	valid := []string{
		"https://hooks.example.org/services/abc",
		"http://localhost:9000/hook",
		"http://192.168.1.10/hook",
		"http://relay.local/hook",
	}
	for _, raw := range valid {
		if err := ValidateWebhookURL(raw); err != nil {
			t.Errorf("ValidateWebhookURL(%q) = %v, want nil", raw, err)
		}
	}
	invalid := []string{
		"http://hooks.example.org/hook",      // public plain HTTP
		"ftp://example.org/hook",             // wrong scheme
		"https://user:pass@example.org/hook", // credentials in the URL
		"not a url at all",
		"https://",
	}
	for _, raw := range invalid {
		if err := ValidateWebhookURL(raw); err == nil {
			t.Errorf("ValidateWebhookURL(%q) = nil, want an error", raw)
		}
	}
}

func TestNewSigningSecretIsUniqueAndPrefixed(t *testing.T) {
	first, err := NewSigningSecret()
	if err != nil {
		t.Fatalf("NewSigningSecret: %v", err)
	}
	second, _ := NewSigningSecret()
	if first == second {
		t.Error("signing secrets must not repeat")
	}
	if !strings.HasPrefix(first, "whsec_") {
		t.Errorf("secret = %q, want a whsec_ prefix", first)
	}
	if len(first) < 40 {
		t.Errorf("secret is only %d characters", len(first))
	}
}

func TestComposeEmailSingleCondition(t *testing.T) {
	policy := testSettings(t, map[string]any{})
	subject, body := composeEmail(policy, []pendingDelivery{{
		category: CategoryIncident, severity: "error",
		subject: "Screen stopped reporting - Cafeteria",
		body:    "The Player stopped reporting.",
		payload: []byte(`{"studioPath":"/activity/incidents"}`),
	}}, "https://signage.example.org")

	if subject != "Screen stopped reporting - Cafeteria" {
		t.Errorf("subject = %q", subject)
	}
	if !strings.Contains(body, "https://signage.example.org/activity/incidents") {
		t.Errorf("body has no Studio link:\n%s", body)
	}
	if !strings.Contains(body, "My preferences") {
		t.Error("body must say how to change what is received")
	}
}

func TestComposeEmailDigestGroupsAndOrdersBySeverity(t *testing.T) {
	policy := testSettings(t, map[string]any{})
	subject, body := composeEmail(policy, []pendingDelivery{
		{category: CategoryIncident, severity: "warning", subject: "Storage is nearly full", payload: []byte(`{}`)},
		{category: CategoryIncident, severity: "critical", subject: "Player is in safe mode", payload: []byte(`{}`)},
	}, "https://signage.example.org")

	if !strings.Contains(subject, "2 conditions") || !strings.Contains(subject, "1 critical") {
		t.Errorf("subject = %q, want a count and the critical tally", subject)
	}
	safeMode := strings.Index(body, "Player is in safe mode")
	storage := strings.Index(body, "Storage is nearly full")
	if safeMode < 0 || storage < 0 || safeMode > storage {
		t.Errorf("critical must be listed first:\n%s", body)
	}
}

func TestBuildMIMEEscapesLeadingDotAndEncodesSubject(t *testing.T) {
	from := mail.Address{Name: "Tilecast", Address: "signage@example.org"}
	to := mail.Address{Address: "caretaker@example.org"}
	raw := string(buildMIME(from, to, Message{
		Subject:  "Screen offline — Café",
		Body:     "line one\n.\nline three",
		Category: CategoryIncident,
	}))

	if strings.Contains(raw, "Subject: Screen offline — Café") {
		t.Error("a non-ASCII subject must be encoded, not sent raw")
	}
	if !strings.Contains(raw, "\r\n..\r\n") {
		t.Errorf("a line containing only a dot must be escaped:\n%q", raw)
	}
	if !strings.Contains(raw, "Auto-Submitted: auto-generated") {
		t.Error("automated mail must identify itself so it is not auto-replied to")
	}
	if !strings.Contains(raw, "X-Tilecast-Category: incident") {
		t.Error("the category header is missing")
	}
}

func TestEncodePayloadIsAStableContract(t *testing.T) {
	payload, err := EncodePayload(Event{
		Key: "incident:abc:opened", Category: CategoryIncident, Severity: "error",
		Subject: "Screen stopped reporting", Body: "detail",
		OccurredAt: time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC),
		Payload:    map[string]any{"screenId": "s1"},
	})
	if err != nil {
		t.Fatalf("EncodePayload: %v", err)
	}
	for _, want := range []string{
		`"event":"incident:abc:opened"`,
		`"category":"incident"`,
		`"severity":"error"`,
		`"occurredAt":"2026-03-04T12:00:00Z"`,
		`"screenId":"s1"`,
	} {
		if !strings.Contains(string(payload), want) {
			t.Errorf("payload is missing %s:\n%s", want, payload)
		}
	}
}

func TestCategoryPreferenceKeyIsClosed(t *testing.T) {
	// An unknown category must not resolve onto a key that happens to be true.
	if key := categoryPreferenceKey("everything"); key != "preference.notifications.everything" {
		t.Errorf("key = %q", key)
	}
	if categoryPreferenceKey(CategoryContentHealth) != "preference.notifications.content_health" {
		t.Error("content health maps to the wrong preference key")
	}
}

func TestRecoveryEventPresentsAsInfoButKeepsItsFloor(t *testing.T) {
	transition := incidentTransition{
		kind: "recovered", incidentTyp: "connectivity", severity: "error",
		title: "Screen stopped reporting", description: "Screen is reporting again.",
		screenName: "Cafeteria", locationName: "Main Building",
		at: time.Now(),
	}
	event := transition.event()
	if event.Severity != "info" {
		t.Errorf("severity = %q, want info", event.Severity)
	}
	if event.FloorSeverity != "error" {
		t.Errorf("floor = %q, want error so the original recipients are told", event.FloorSeverity)
	}
	if !strings.HasPrefix(event.Subject, "Recovered: ") {
		t.Errorf("subject = %q", event.Subject)
	}
	if !strings.Contains(event.Subject, "Cafeteria (Main Building)") {
		t.Errorf("subject must name the screen: %q", event.Subject)
	}
	if !strings.HasSuffix(event.Key, ":recovered") {
		t.Errorf("key = %q, want a recovered suffix distinct from the open", event.Key)
	}
}

func TestIncidentTypeChoosesTheSubscriptionCategory(t *testing.T) {
	cases := map[string]string{
		"connectivity": CategoryIncident,
		"playback":     CategoryIncident,
		"safe_mode":    CategoryIncident,
		"update":       CategoryUpdate,
		"data_source":  CategoryContentHealth,
		"content":      CategoryContentHealth,
	}
	for incidentType, want := range cases {
		if got := categoryForIncidentType(incidentType); got != want {
			t.Errorf("categoryForIncidentType(%q) = %q, want %q", incidentType, got, want)
		}
	}
}

func TestTruncateBoundsStoredText(t *testing.T) {
	if got := truncate("short", 100); got != "short" {
		t.Errorf("truncate shortened a short value: %q", got)
	}
	got := truncate(strings.Repeat("x", 50), 10)
	if len(got) >= 50 || !strings.HasSuffix(got, "[truncated]") {
		t.Errorf("truncate = %q", got)
	}
}
