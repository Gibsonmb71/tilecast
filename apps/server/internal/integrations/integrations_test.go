package integrations

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseAuthorizationAcceptsOnlyATilecastToken(t *testing.T) {
	publicID, secret, ok := parseAuthorization("Bearer tci_abc123.s3cret")
	if !ok || publicID != "abc123" || secret != "s3cret" {
		t.Fatalf("parseAuthorization = %q, %q, %v", publicID, secret, ok)
	}
	rejected := []string{
		"",
		"Bearer",
		"Bearer tci_",
		"Bearer tci_abc123",    // no secret
		"Bearer tci_.secret",   // no public id
		"Bearer tc_device_a.b", // a device credential is not a token
		"tci_abc123.secret",    // no scheme
		"Basic tci_abc123.secret",
	}
	for _, header := range rejected {
		if _, _, ok := parseAuthorization(header); ok {
			t.Errorf("parseAuthorization(%q) accepted", header)
		}
	}
}

func TestParseAuthorizationKeepsTheSecretIntactWhenItContainsPadding(t *testing.T) {
	// Cut splits on the first dot, and base64url never produces one, so a
	// secret is returned whole.
	_, secret, ok := parseAuthorization("Bearer tci_abc.AAA-_bbb")
	if !ok || secret != "AAA-_bbb" {
		t.Errorf("secret = %q, ok = %v", secret, ok)
	}
}

func TestNormalizeScopesIsAClosedSet(t *testing.T) {
	got, err := normalizeScopes([]string{ScopeActivityRead, ScopeDataSourceWrite, ScopeActivityRead})
	if err != nil {
		t.Fatalf("normalizeScopes: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("scopes = %v, want the duplicate removed", got)
	}
	if _, err := normalizeScopes([]string{"settings:write"}); !errors.Is(err, ErrValidation) {
		t.Error("an unknown scope must be rejected, not ignored")
	}
	if _, err := normalizeScopes(nil); !errors.Is(err, ErrValidation) {
		t.Error("a token with no scope must be rejected")
	}
}

func TestHasScope(t *testing.T) {
	principal := Principal{Scopes: []string{ScopeActivityRead}}
	if !principal.HasScope(ScopeActivityRead) {
		t.Error("held scope not reported")
	}
	if principal.HasScope(ScopeDataSourceWrite) {
		t.Error("a read token must not report a write scope")
	}
}

func TestMayWriteRequiresTheScope(t *testing.T) {
	id := uuid.New()
	readOnly := Principal{Scopes: []string{ScopeActivityRead}}
	if readOnly.MayWrite(id) {
		t.Error("a read token must not be able to write")
	}
}

func TestMayWriteUnnarrowedTokenWritesAnySource(t *testing.T) {
	principal := Principal{Scopes: []string{ScopeDataSourceWrite}}
	if !principal.MayWrite(uuid.New()) {
		t.Error("an unnarrowed write token must write any Manual Table source")
	}
}

func TestMayWriteNarrowedTokenIsLimitedToItsSources(t *testing.T) {
	allowed, other := uuid.New(), uuid.New()
	principal := Principal{
		Scopes:        []string{ScopeDataSourceWrite},
		DataSourceIDs: []uuid.UUID{allowed},
	}
	if !principal.MayWrite(allowed) {
		t.Error("the named source must be writable")
	}
	if principal.MayWrite(other) {
		t.Error("a source that was not named must not be writable")
	}
}

func TestTokenActive(t *testing.T) {
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	if (Token{}).Active() != true {
		t.Error("a token with no expiry and no revocation is active")
	}
	if (Token{RevokedAt: &past}).Active() {
		t.Error("a revoked token is not active")
	}
	if (Token{ExpiresAt: &past}).Active() {
		t.Error("an expired token is not active")
	}
	if !(Token{ExpiresAt: &future}).Active() {
		t.Error("a token expiring later is active")
	}
}

func TestNewCredentialProducesDistinctHighEntropyValues(t *testing.T) {
	firstPublic, firstSecret, err := newCredential()
	if err != nil {
		t.Fatalf("newCredential: %v", err)
	}
	secondPublic, secondSecret, _ := newCredential()
	if firstPublic == secondPublic || firstSecret == secondSecret {
		t.Error("credentials must not repeat")
	}
	if len(firstPublic) != 24 {
		t.Errorf("public id is %d characters, want 24", len(firstPublic))
	}
	if len(firstSecret) < 40 {
		t.Errorf("secret is only %d characters", len(firstSecret))
	}
	if strings.Contains(firstSecret, ".") {
		t.Error("a secret containing a dot would break token parsing")
	}
}

func TestPrometheusRendersEveryFamilyIncludingZeros(t *testing.T) {
	var health FleetHealth
	health.Screens.Total = 12
	health.Screens.Recent = 9
	health.Screens.Stale = 1
	health.Screens.Offline = 2
	health.Incidents.BySeverity = map[string]int{"error": 2, "warning": 1}
	health.Content.StaleDataSources = 1

	text := health.Prometheus()
	for _, want := range []string{
		"# TYPE tilecast_screens gauge",
		`tilecast_screens{state="offline"} 2`,
		`tilecast_screens{state="recent"} 9`,
		"tilecast_screens_total 12",
		`tilecast_incidents_unresolved{severity="error"} 2`,
		`tilecast_content_problems{kind="stale_data_source"} 1`,
		`tilecast_content_problems{kind="empty_playlist"} 0`,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("metrics output is missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "online") {
		t.Error("there is no online count: presence is not visible to a database read")
	}
}

func TestPrometheusEmitsAZeroWhenThereAreNoIncidents(t *testing.T) {
	// An absent metric family reads as "no data" in Prometheus, which is not
	// the same as zero, and would leave an alert rule permanently unevaluated.
	var health FleetHealth
	health.Incidents.BySeverity = map[string]int{}
	text := health.Prometheus()
	if !strings.Contains(text, "tilecast_incidents_unresolved{") {
		t.Errorf("expected an explicit zero:\n%s", text)
	}
}

func TestPrometheusOutputIsStablyOrdered(t *testing.T) {
	var health FleetHealth
	health.Incidents.BySeverity = map[string]int{"warning": 1, "critical": 2, "error": 3}
	first := health.Prometheus()
	for i := 0; i < 5; i++ {
		if health.Prometheus() != first {
			t.Fatal("metric order must not depend on map iteration order")
		}
	}
}
