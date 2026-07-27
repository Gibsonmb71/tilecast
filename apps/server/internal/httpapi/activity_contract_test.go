package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

// The fixtures are shared with the Kotlin and TypeScript player tests, so one
// change to the contract fails all three suites at once.
const contractFixturePath = "../../../../packages/api-schema/activity/contract-v2-fixtures.json"

type contractFixtures struct {
	Version             int               `json:"version"`
	CanonicalEventTypes map[string]string `json:"canonicalEventTypes"`
	SessionTypes        []string          `json:"sessionTypes"`
	TerminalReasons     map[string]struct {
		Expected *bool `json:"expected"`
	} `json:"terminalReasons"`
	Scenarios []contractScenario `json:"scenarios"`
}

type contractScenario struct {
	Name               string   `json:"name"`
	LegacyAliasPlayers []string `json:"legacyAliasPlayers"`
	Expected           struct {
		Sessions []struct {
			ActivitySessionID  string   `json:"activitySessionId"`
			SessionType        string   `json:"sessionType"`
			Result             string   `json:"result"`
			TerminalReason     *string  `json:"terminalReason"`
			StartOffsetSeconds float64  `json:"startOffsetSeconds"`
			EndOffsetSeconds   *float64 `json:"endOffsetSeconds"`
			ParentSessionID    *string  `json:"parentActivitySessionId"`
		} `json:"sessions"`
		OpenStateIntervals []string `json:"openStateIntervals"`
	} `json:"expected"`
	Emissions map[string][]contractEmission `json:"emissions"`
}

type contractEmission struct {
	OffsetSeconds      float64 `json:"offsetSeconds"`
	EventType          string  `json:"eventType"`
	ActivitySessionID  string  `json:"activitySessionId"`
	ParentSessionID    string  `json:"parentActivitySessionId"`
	SessionType        string  `json:"sessionType"`
	TerminalReason     string  `json:"terminalReason"`
	PresentationType   string  `json:"presentationType"`
	PresentationID     string  `json:"presentationId"`
	ContentType        string  `json:"contentType"`
	ContentID          string  `json:"contentId"`
	Result             string  `json:"result"`
	Trigger            string  `json:"trigger"`
	ScheduleID         string  `json:"scheduleId"`
	FailureCode        string  `json:"failureCode"`
	DurationMS         *int64  `json:"durationMs"`
	ExpectedDurationMS *int64  `json:"expectedDurationMs"`
}

func loadContractFixtures(t *testing.T) contractFixtures {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(contractFixturePath))
	if err != nil {
		t.Fatalf("shared contract fixtures: %v", err)
	}
	var fixtures contractFixtures
	if err := json.Unmarshal(raw, &fixtures); err != nil {
		t.Fatal(err)
	}
	if fixtures.Version != 2 {
		t.Fatalf("fixture contract version = %d, want 2", fixtures.Version)
	}
	return fixtures
}

// The server's alias table is the transition mechanism. If it drifts from the
// fixtures, a v1 player silently stops deriving sessions.
func TestServerAliasesMatchTheSharedContract(t *testing.T) {
	fixtures := loadContractFixtures(t)
	for alias, canonical := range fixtures.CanonicalEventTypes {
		if got := canonicalActivityEventType(alias); got != canonical {
			t.Errorf("canonicalActivityEventType(%q) = %q, want %q", alias, got, canonical)
		}
	}
	for _, sessionType := range fixtures.SessionTypes {
		if !isActivitySessionType(sessionType) {
			t.Errorf("%q is a contract session type the server rejects", sessionType)
		}
	}
	expected := map[string]bool{}
	for reason, spec := range fixtures.TerminalReasons {
		if !isActivityTerminalReason(reason) {
			t.Errorf("%q is a contract terminal reason the server rejects", reason)
		}
		if spec.Expected != nil && *spec.Expected {
			expected[reason] = true
		}
	}
	// The interruption set must be exactly the unexpected reasons, minus
	// unknown. Counting unknown would classify every legacy record as a fault.
	for _, reason := range interruptedTerminalReasons() {
		if reason == terminalUnknown || expected[reason] {
			t.Errorf("%q must not count as an interruption", reason)
		}
	}
	for reason, spec := range fixtures.TerminalReasons {
		if spec.Expected != nil && !*spec.Expected {
			if !contains(interruptedTerminalReasons(), reason) {
				t.Errorf("%q is an unexpected ending but is not counted as an interruption", reason)
			}
		}
	}
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// Value types only: the sessions are compared with ==, and pointer fields
// would compare addresses rather than the derivation they stand for.
type derivedSession struct {
	ActivitySessionID string
	SessionType       string
	Result            string
	TerminalReason    string
	StartOffset       float64
	Ended             bool
	EndOffset         float64
	ParentSessionID   string
}

// TestEquivalentPlayerSequencesDeriveEquivalentSessions is the contract's
// central claim: the same playback, reported in either player's vocabulary,
// must produce the same playback sessions and the same screen state timeline.
func TestEquivalentPlayerSequencesDeriveEquivalentSessions(t *testing.T) {
	fixtures := loadContractFixtures(t)
	for _, scenario := range fixtures.Scenarios {
		t.Run(scenario.Name, func(t *testing.T) {
			perPlayer := map[string][]derivedSession{}
			perPlayerStates := map[string][]string{}
			for _, player := range []string{"android", "linux"} {
				withActivityDatabase(t, func(env activityTestEnvironment) {
					anchor := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
					replay(t, env, scenario.Emissions[player], anchor)
					perPlayer[player] = readDerivedSessions(t, env, anchor)
					perPlayerStates[player] = readOpenStates(t, env)
				})
			}

			if len(perPlayer) != 2 {
				t.Fatalf("both player columns must be replayed, got %d", len(perPlayer))
			}
			android, linux := perPlayer["android"], perPlayer["linux"]
			if len(android) != len(linux) {
				t.Fatalf("android derived %d sessions, linux derived %d", len(android), len(linux))
			}
			for index := range android {
				if android[index] != linux[index] {
					t.Fatalf("session %d differs by platform:\n  android %+v\n  linux   %+v", index, android[index], linux[index])
				}
			}
			if got, want := perPlayerStates["android"], perPlayerStates["linux"]; !equalStrings(got, want) {
				t.Fatalf("open screen states differ by platform: android %v, linux %v", got, want)
			}

			// And both must match what the contract says the playback was.
			if len(android) != len(scenario.Expected.Sessions) {
				t.Fatalf("derived %d sessions, contract expects %d: %+v", len(android), len(scenario.Expected.Sessions), android)
			}
			expected := make([]derivedSession, 0, len(scenario.Expected.Sessions))
			for _, session := range scenario.Expected.Sessions {
				item := derivedSession{
					ActivitySessionID: session.ActivitySessionID,
					SessionType:       session.SessionType,
					Result:            session.Result,
					StartOffset:       session.StartOffsetSeconds,
				}
				if session.TerminalReason != nil {
					item.TerminalReason = *session.TerminalReason
				}
				if session.EndOffsetSeconds != nil {
					item.Ended, item.EndOffset = true, *session.EndOffsetSeconds
				}
				if session.ParentSessionID != nil {
					item.ParentSessionID = *session.ParentSessionID
				}
				expected = append(expected, item)
			}
			sort.Slice(expected, func(i, j int) bool {
				return expected[i].ActivitySessionID < expected[j].ActivitySessionID
			})
			for index := range expected {
				if android[index] != expected[index] {
					t.Fatalf("session %d:\n  derived  %+v\n  contract %+v", index, android[index], expected[index])
				}
			}
			if got := perPlayerStates["android"]; !equalStrings(got, scenario.Expected.OpenStateIntervals) {
				t.Fatalf("open screen states = %v, contract expects %v", got, scenario.Expected.OpenStateIntervals)
			}
		})
	}
}

func replay(t *testing.T, env activityTestEnvironment, emissions []contractEmission, anchor time.Time) {
	t.Helper()
	events := make([]playerActivityEventInput, 0, len(emissions))
	for index, emission := range emissions {
		events = append(events, playerActivityEventInput{
			ID:                 uuid.New(),
			Sequence:           int64(index + 1),
			EventType:          emission.EventType,
			OccurredAt:         anchor.Add(time.Duration(emission.OffsetSeconds) * time.Second),
			PlayerTimezone:     "UTC",
			ActivitySessionID:  emission.ActivitySessionID,
			ParentSessionID:    emission.ParentSessionID,
			SessionType:        emission.SessionType,
			TerminalReason:     emission.TerminalReason,
			PresentationType:   emission.PresentationType,
			PresentationID:     emission.PresentationID,
			ContentType:        emission.ContentType,
			ContentID:          emission.ContentID,
			Result:             emission.Result,
			TriggerContext:     emission.Trigger,
			ScheduleID:         emission.ScheduleID,
			FailureCode:        emission.FailureCode,
			DurationMS:         emission.DurationMS,
			ExpectedDurationMS: emission.ExpectedDurationMS,
		})
	}
	if len(events) == 0 {
		return
	}
	postActivityBatch(t, env, playerActivityBatchInput{Events: events}, http.StatusAccepted)
}

func readDerivedSessions(t *testing.T, env activityTestEnvironment, anchor time.Time) []derivedSession {
	t.Helper()
	rows, err := env.pool.Query(context.Background(), `
		SELECT p.activity_session_id,p.session_type,p.result,COALESCE(p.terminal_reason,''),
		       EXTRACT(EPOCH FROM (p.started_at-$2))::float8,
		       CASE WHEN p.ended_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM (p.ended_at-$2))::float8 END,
		       parent.activity_session_id
		FROM playback_sessions p
		LEFT JOIN playback_sessions parent ON parent.id=p.parent_session_id
		WHERE p.screen_id=$1 ORDER BY p.activity_session_id`, env.screenID, anchor)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	sessions := []derivedSession{}
	for rows.Next() {
		var session derivedSession
		var endOffset *float64
		var parent *string
		if err := rows.Scan(&session.ActivitySessionID, &session.SessionType, &session.Result,
			&session.TerminalReason, &session.StartOffset, &endOffset, &parent); err != nil {
			t.Fatal(err)
		}
		if endOffset != nil {
			session.Ended, session.EndOffset = true, *endOffset
		}
		if parent != nil {
			session.ParentSessionID = *parent
		}
		sessions = append(sessions, session)
	}
	return sessions
}

func readOpenStates(t *testing.T, env activityTestEnvironment) []string {
	t.Helper()
	rows, err := env.pool.Query(context.Background(),
		`SELECT state FROM screen_state_intervals WHERE screen_id=$1 AND ended_at IS NULL ORDER BY state`, env.screenID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	states := []string{}
	for rows.Next() {
		var state string
		if err := rows.Scan(&state); err != nil {
			t.Fatal(err)
		}
		states = append(states, state)
	}
	return states
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
