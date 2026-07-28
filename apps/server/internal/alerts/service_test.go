package alerts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeCodes(t *testing.T) {
	got, err := normalizeCodes([]string{" oh ", "PA", "OH"}, 2, "area")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"OH", "PA"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("normalizeCodes() = %#v, want %#v", got, want)
	}
	if _, err = normalizeCodes([]string{"O!"}, 2, "area"); err == nil {
		t.Fatal("normalizeCodes accepted punctuation")
	}
}

func TestFetchIdentifiesTilecastAndDecodesGeoJSON(t *testing.T) {
	var gotQuery, gotAccept, gotAgent string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		gotAccept = r.Header.Get("Accept")
		gotAgent = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "application/geo+json")
		_, _ = w.Write([]byte(`{"features":[{"id":"alert-1","properties":{"id":"alert-1","event":"Tornado Warning","severity":"Extreme","urgency":"Immediate"}}]}`))
	}))
	defer upstream.Close()
	service := &Service{
		client:    upstream.Client(),
		baseURL:   upstream.URL,
		userAgent: "Tilecast/1.0 (https://tilecast.example)",
	}
	collection, err := service.fetch(context.Background(), "area", "OH,PA")
	if err != nil {
		t.Fatal(err)
	}
	if len(collection.Features) != 1 || collection.Features[0].Properties.Event != "Tornado Warning" {
		t.Fatalf("unexpected decoded collection: %#v", collection)
	}
	if !strings.Contains(gotQuery, "area=OH%2CPA") || !strings.Contains(gotQuery, "message_type=alert") {
		t.Fatalf("unexpected query: %s", gotQuery)
	}
	if gotAccept != "application/geo+json" || !strings.HasPrefix(gotAgent, "Tilecast/") {
		t.Fatalf("headers Accept=%q User-Agent=%q", gotAccept, gotAgent)
	}
}

func TestMatchesUsesClosedSeverityAndUrgencyOrdering(t *testing.T) {
	rule := Rule{
		EventNames:      []string{"Tornado Warning"},
		MinimumSeverity: "Severe",
		MinimumUrgency:  "Expected",
	}
	if !matches(rule, "tornado warning", "Extreme", "Immediate") {
		t.Fatal("expected stronger, case-insensitive alert to match")
	}
	if matches(rule, "Tornado Watch", "Extreme", "Immediate") {
		t.Fatal("unexpected event name match")
	}
	if matches(rule, "Tornado Warning", "Moderate", "Immediate") {
		t.Fatal("unexpected lower-severity match")
	}
	if matches(rule, "Tornado Warning", "Extreme", "Future") {
		t.Fatal("unexpected lower-urgency match")
	}
}

func TestAlertExpiryIsBoundedAndPrefersEnds(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	expires := now.Add(2 * time.Hour)
	ends := now.Add(90 * time.Minute)
	if got := alertExpiry(nwsProperties{Expires: &expires, Ends: &ends}, now, 360); !got.Equal(ends) {
		t.Fatalf("alertExpiry() = %s, want ends %s", got, ends)
	}
	tooLate := now.Add(12 * time.Hour)
	if got := alertExpiry(nwsProperties{Expires: &tooLate}, now, 360); !got.Equal(now.Add(6 * time.Hour)) {
		t.Fatalf("alertExpiry() = %s, want six-hour ceiling", got)
	}
}

func TestNWSAlertActiveUsesTheAuthoritativeEnd(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	expired := now.Add(-time.Minute)
	future := now.Add(time.Hour)
	if nwsAlertActive(nwsProperties{Expires: &expired}, now) {
		t.Fatal("expired alert was treated as active")
	}
	if !nwsAlertActive(nwsProperties{Expires: &future}, now) {
		t.Fatal("future alert was not treated as active")
	}
}
