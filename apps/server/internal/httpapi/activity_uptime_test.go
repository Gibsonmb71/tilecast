package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBuildUptimeReportSeparatesHealthyImpairedAndDownTime(t *testing.T) {
	spec := uptimeWindowSpecs["24h"]
	to := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	from := to.Add(-2 * time.Hour)
	cafeteria, library := uuid.New(), uuid.New()
	rows := []uptimeRow{
		// A fully healthy screen.
		{ScreenID: cafeteria, ScreenName: "Cafeteria", BucketStart: from, BucketEnd: from.Add(time.Hour), UpSeconds: 3600},
		{ScreenID: cafeteria, ScreenName: "Cafeteria", BucketStart: from.Add(time.Hour), BucketEnd: to, UpSeconds: 3600},
		// A screen that spent the second hour half down and half impaired.
		{ScreenID: library, ScreenName: "Library", BucketStart: from, BucketEnd: from.Add(time.Hour), UpSeconds: 3600},
		{ScreenID: library, ScreenName: "Library", BucketStart: from.Add(time.Hour), BucketEnd: to, ImpairedSec: 1800, DownSeconds: 1800},
	}

	report := buildUptimeReport(rows, spec, from, to)

	if report.ScreensTracked != 2 || report.ScreensWithDowntime != 1 {
		t.Fatalf("expected two tracked screens and one with downtime, got %d and %d", report.ScreensTracked, report.ScreensWithDowntime)
	}
	if report.UpSeconds != 10800 || report.ImpairedSeconds != 1800 || report.DownSeconds != 1800 {
		t.Fatalf("unexpected totals: up=%d impaired=%d down=%d", report.UpSeconds, report.ImpairedSeconds, report.DownSeconds)
	}
	if report.UptimePercent == nil || *report.UptimePercent != 75 {
		t.Fatalf("expected 75%% healthy time, got %v", report.UptimePercent)
	}
	if len(report.Buckets) != 2 {
		t.Fatalf("expected one bucket per hour, got %d", len(report.Buckets))
	}
	if report.Buckets[0].UpPercent != 100 || report.Buckets[0].ScreensDown != 0 {
		t.Fatalf("first bucket should be fully up: %+v", report.Buckets[0])
	}
	second := report.Buckets[1]
	if second.UpPercent != 50 || second.ImpairedPercent != 25 || second.DownPercent != 25 || second.ScreensDown != 1 {
		t.Fatalf("unexpected second bucket: %+v", second)
	}
	// The worst screen is listed first so the panel reads as a work queue.
	if report.Screens[0].ScreenName != "Library" || report.Screens[0].DownSeconds != 1800 {
		t.Fatalf("expected Library ranked first: %+v", report.Screens[0])
	}
	if got := report.Screens[0].Buckets; len(got) != 2 || got[0] != "up" || got[1] != "down" {
		t.Fatalf("unexpected Library strip: %v", got)
	}
	if got := report.Screens[1].Buckets; got[0] != "up" || got[1] != "up" {
		t.Fatalf("unexpected Cafeteria strip: %v", got)
	}
}

func TestBuildUptimeReportReportsUnmeasuredTimeInsteadOfGuessing(t *testing.T) {
	spec := uptimeWindowSpecs["24h"]
	to := time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC)
	from := to.Add(-time.Hour)
	screenID := uuid.New()
	rows := []uptimeRow{{ScreenID: screenID, ScreenName: "New TV", BucketStart: from, BucketEnd: to}}

	report := buildUptimeReport(rows, spec, from, to)

	if report.UptimePercent != nil {
		t.Fatalf("a screen with no recorded state must not report a percentage, got %v", *report.UptimePercent)
	}
	if report.Buckets[0].UnknownPercent != 100 {
		t.Fatalf("expected the bucket to be entirely unmeasured: %+v", report.Buckets[0])
	}
	if report.Screens[0].Buckets[0] != "unknown" {
		t.Fatalf("expected an unknown strip cell, got %q", report.Screens[0].Buckets[0])
	}
}

func TestClampUptimeSegmentsKeepsBucketsWithinTheirSpan(t *testing.T) {
	up, impaired, down := clampUptimeSegments(3600, 1800, 1800, 3600)
	if total := up + impaired + down; total != 3600 {
		t.Fatalf("expected overlapping intervals to be scaled into the bucket, got %v", total)
	}
	if up != 1800 {
		t.Fatalf("expected proportional scaling, got up=%v", up)
	}
}

func TestUptimeCountsSilentPlayerAsDownRatherThanStillHealthy(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		ctx := context.Background()
		now := time.Now().UTC()
		// The player reported healthy six hours ago and stopped heartbeating two
		// hours ago without ever sending a disconnect event.
		if _, err := env.pool.Exec(ctx, `UPDATE screens SET last_heartbeat_at=$2 WHERE id=$1`, env.screenID, now.Add(-2*time.Hour)); err != nil {
			t.Fatal(err)
		}
		if _, err := env.pool.Exec(ctx, `INSERT INTO screen_state_intervals(id,screen_id,state,started_at) VALUES($1,$2,'healthy',$3)`, uuid.New(), env.screenID, now.Add(-6*time.Hour)); err != nil {
			t.Fatal(err)
		}

		request := httptest.NewRequest(http.MethodGet, "/api/v1/activity/uptime?window=24h", nil)
		request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, env.owner))
		response := httptest.NewRecorder()
		env.server.activityUptime(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Data uptimeReport `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		report := payload.Data
		if report.Window != "24h" || len(report.Buckets) != 24 {
			t.Fatalf("expected twenty-four hourly buckets, got window %q with %d", report.Window, len(report.Buckets))
		}
		// Downtime starts one gap grace period after the last heartbeat.
		expectedDown := int64((2*time.Hour - uptimeHeartbeatGrace).Seconds())
		if difference := report.DownSeconds - expectedDown; difference < -60 || difference > 60 {
			t.Fatalf("expected about %d seconds of downtime, got %d", expectedDown, report.DownSeconds)
		}
		if report.UpSeconds < int64((3 * time.Hour).Seconds()) {
			t.Fatalf("expected the healthy stretch to be counted, got %d seconds", report.UpSeconds)
		}
		// Time before the first recorded interval stays unmeasured rather than
		// counting against uptime.
		if report.TrackedSeconds-report.UpSeconds-report.DownSeconds-report.ImpairedSeconds < int64((17 * time.Hour).Seconds()) {
			t.Fatalf("expected the untracked remainder of the window to be excluded: %+v", report)
		}
		if report.UptimePercent == nil || *report.UptimePercent > 70 || *report.UptimePercent < 60 {
			t.Fatalf("expected roughly two thirds healthy time, got %v", report.UptimePercent)
		}
		if len(report.Screens) != 1 || report.Screens[0].DownSeconds == 0 {
			t.Fatalf("expected the screen row to carry its downtime: %+v", report.Screens)
		}
		if state := report.Screens[0].Buckets[len(report.Screens[0].Buckets)-1]; state != "down" {
			t.Fatalf("expected the newest strip cell to be down, got %q", state)
		}
	})
}

func TestUptimeSeparatesHeartbeatGapsFromContentFailures(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		ctx := context.Background()
		now := time.Now().UTC()
		insert := func(state, reason string, start, end time.Time) {
			if _, err := env.pool.Exec(ctx, `INSERT INTO screen_state_intervals(id,screen_id,state,started_at,ended_at,reason_code) VALUES($1,$2,$3,$4,$5,NULLIF($6,''))`, uuid.New(), env.screenID, state, start, end, reason); err != nil {
				t.Fatal(err)
			}
		}
		// Four closed hours: healthy, a detected heartbeat gap, a renderer failure,
		// and an explicit disconnect.
		insert("healthy", "", now.Add(-4*time.Hour), now.Add(-3*time.Hour))
		insert("degraded", "heartbeat_gap", now.Add(-3*time.Hour), now.Add(-2*time.Hour))
		insert("degraded", "playback_error", now.Add(-2*time.Hour), now.Add(-time.Hour))
		insert("offline", "", now.Add(-time.Hour), now)
		if _, err := env.pool.Exec(ctx, `UPDATE screens SET last_heartbeat_at=$2 WHERE id=$1`, env.screenID, now); err != nil {
			t.Fatal(err)
		}

		request := httptest.NewRequest(http.MethodGet, "/api/v1/activity/uptime?window=7d", nil)
		request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, env.owner))
		response := httptest.NewRecorder()
		env.server.activityUptime(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("unexpected status %d: %s", response.Code, response.Body.String())
		}
		var payload struct {
			Data uptimeReport `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		report := payload.Data
		if len(report.Buckets) != 28 {
			t.Fatalf("expected twenty-eight six-hour buckets, got %d", len(report.Buckets))
		}
		hour := int64(time.Hour.Seconds())
		if near := func(got, want int64) bool { return got-want > -60 && got-want < 60 }; !near(report.UpSeconds, hour) ||
			!near(report.ImpairedSeconds, hour) || !near(report.DownSeconds, 2*hour) {
			t.Fatalf("expected one healthy hour, one impaired hour, and two down hours: up=%d impaired=%d down=%d", report.UpSeconds, report.ImpairedSeconds, report.DownSeconds)
		}
		if report.UptimePercent == nil || *report.UptimePercent > 26 || *report.UptimePercent < 24 {
			t.Fatalf("expected a quarter of measured time healthy, got %v", report.UptimePercent)
		}
	})
}

func TestUptimeRejectsUnsupportedWindow(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/activity/uptime?window=90d", nil)
	response := httptest.NewRecorder()
	(&server{}).activityUptime(response, request)
	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for an unsupported window, got %d", response.Code)
	}
}
