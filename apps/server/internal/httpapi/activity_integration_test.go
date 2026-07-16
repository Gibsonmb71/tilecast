package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

type activityTestEnvironment struct {
	server   *server
	pool     *pgxpool.Pool
	screenID uuid.UUID
	owner    auth.Session
}

func withActivityDatabase(t *testing.T, run func(activityTestEnvironment)) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	lockPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer lockPool.Close()
	lock, err := lockPool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Release()
	if _, err = lock.Exec(ctx, `SELECT pg_advisory_lock(7421999)`); err != nil {
		t.Fatal(err)
	}
	defer lock.Exec(ctx, `SELECT pg_advisory_unlock(7421999)`) //nolint:errcheck
	if err = database.Migrate(ctx, databaseURL); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings, users CASCADE`); err != nil {
		t.Fatal(err)
	}
	organizationID, screenID, ownerID := uuid.New(), uuid.New(), uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(true,'Activity Test',$1)`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,username,password_hash,role,active) VALUES($1,'Activity Owner','activity-owner','unused-test-hash','owner',TRUE)`, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone) VALUES($1,$2,$3,'Cafeteria TV','android-tv','Test','TV','14','1.0',1920,1080,1,'en-US','America/New_York')`, screenID, organizationID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	s := &server{db: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	run(activityTestEnvironment{server: s, pool: pool, screenID: screenID, owner: auth.Session{User: auth.User{ID: ownerID, Name: "Activity Owner", Username: "activity-owner", Role: "owner", Active: true}}})
}

func TestPlayerActivityDeduplicatesOrdersAndDerivesSessions(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		startID, endID := uuid.New(), uuid.New()
		started := time.Now().UTC().Add(-30 * time.Second).Truncate(time.Microsecond)
		batch := playerActivityBatchInput{Events: []playerActivityEventInput{
			{ID: startID, Sequence: 1, EventType: "playlist_item.started", OccurredAt: started, PlayerTimezone: "America/New_York", ManifestVersion: int64Pointer(42), PresentationType: "playlist", PresentationID: "morning", PresentationRev: "3", ContentType: "media", ContentID: "welcome-video", PlaylistItemID: "item-1", ActivitySessionID: "session-1", Result: "playing", ExpectedDurationMS: int64Pointer(30_000), TriggerContext: "schedule", ScheduleID: "schedule-1"},
			{ID: endID, Sequence: 2, EventType: "playlist_item.completed", OccurredAt: started.Add(30 * time.Second), PlayerTimezone: "America/New_York", ManifestVersion: int64Pointer(42), PresentationType: "playlist", PresentationID: "morning", ContentType: "media", ContentID: "welcome-video", PlaylistItemID: "item-1", ActivitySessionID: "session-1", Result: "completed", DurationMS: int64Pointer(30_000)},
		}}
		postActivityBatch(t, env, batch, http.StatusAccepted)
		postActivityBatch(t, env, batch, http.StatusAccepted)
		var count int
		if err := env.pool.QueryRow(context.Background(), `SELECT count(*) FROM player_activity_events WHERE screen_id=$1`, env.screenID).Scan(&count); err != nil || count != 2 {
			t.Fatalf("event count=%d err=%v", count, err)
		}
		var result string
		var duration int64
		if err := env.pool.QueryRow(context.Background(), `SELECT result,actual_duration_ms FROM playback_sessions WHERE screen_id=$1 AND activity_session_id='session-1'`, env.screenID).Scan(&result, &duration); err != nil {
			t.Fatal(err)
		}
		if result != "completed" || duration != 30_000 {
			t.Fatalf("session result=%s duration=%d", result, duration)
		}
		rows, err := env.pool.Query(context.Background(), `SELECT sequence FROM player_activity_events WHERE screen_id=$1 ORDER BY sequence`, env.screenID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var sequences []int64
		for rows.Next() {
			var sequence int64
			_ = rows.Scan(&sequence)
			sequences = append(sequences, sequence)
		}
		if len(sequences) != 2 || sequences[0] != 1 || sequences[1] != 2 {
			t.Fatalf("sequences=%v", sequences)
		}
	})
}

func TestPlayerActivityMissingStopsBecomePartialOrUnknown(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		now := time.Now().UTC().Truncate(time.Microsecond)
		batch := playerActivityBatchInput{Events: []playerActivityEventInput{
			{ID: uuid.New(), Sequence: 1, EventType: "presentation.started", OccurredAt: now.Add(-20 * time.Minute), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "lunch", ActivitySessionID: "old-root", Result: "playing"},
			{ID: uuid.New(), Sequence: 2, EventType: "presentation.started", OccurredAt: now.Add(-10 * time.Minute), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "afternoon", ActivitySessionID: "new-root", Result: "playing"},
			{ID: uuid.New(), Sequence: 3, EventType: "widget.started", OccurredAt: now.Add(-7 * time.Hour), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "afternoon", ContentType: "widget", ContentID: "weather", ActivitySessionID: "stale-widget", Result: "playing"},
		}}
		postActivityBatch(t, env, batch, http.StatusAccepted)
		var oldResult, staleResult string
		if err := env.pool.QueryRow(context.Background(), `SELECT result FROM playback_sessions WHERE activity_session_id='old-root'`).Scan(&oldResult); err != nil {
			t.Fatal(err)
		}
		if err := env.pool.QueryRow(context.Background(), `SELECT result FROM playback_sessions WHERE activity_session_id='stale-widget'`).Scan(&staleResult); err != nil {
			t.Fatal(err)
		}
		if oldResult != "partial" || staleResult != "unknown" {
			t.Fatalf("old=%s stale=%s", oldResult, staleResult)
		}
	})
}

func TestLayoutPlaylistZoneAndFailedWidgetPreserveRootSession(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		now := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
		parent := "layout-root"
		batch := playerActivityBatchInput{Events: []playerActivityEventInput{
			{ID: uuid.New(), Sequence: 1, EventType: "presentation.started", OccurredAt: now, PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria-layout", PresentationRev: "4", ActivitySessionID: parent, Result: "playing"},
			{ID: uuid.New(), Sequence: 2, EventType: "playlist_item.started", OccurredAt: now.Add(time.Second), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria-layout", ContentType: "media", ContentID: "lunch-video", PlaylistItemID: "zone-item", LayoutPlacementID: "playlist-zone-a", ActivitySessionID: "zone-play", Result: "playing", Metadata: map[string]any{"parentActivitySessionId": parent}},
			{ID: uuid.New(), Sequence: 3, EventType: "playlist_item.completed", OccurredAt: now.Add(31 * time.Second), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria-layout", ContentType: "media", ContentID: "lunch-video", PlaylistItemID: "zone-item", LayoutPlacementID: "playlist-zone-a", ActivitySessionID: "zone-play", Result: "completed", DurationMS: int64Pointer(30_000)},
			{ID: uuid.New(), Sequence: 4, EventType: "widget.started", OccurredAt: now.Add(2 * time.Second), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria-layout", ContentType: "widget", ContentID: "weather-widget", LayoutPlacementID: "weather-placement", ActivitySessionID: "widget-play", Result: "playing", Metadata: map[string]any{"parentActivitySessionId": parent}},
			{ID: uuid.New(), Sequence: 5, EventType: "widget.failed", OccurredAt: now.Add(4 * time.Second), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria-layout", ContentType: "widget", ContentID: "weather-widget", LayoutPlacementID: "weather-placement", ActivitySessionID: "widget-play", Result: "failed", DurationMS: int64Pointer(2_000), FailureCode: "renderer_failure"},
		}}
		postActivityBatch(t, env, batch, http.StatusAccepted)
		var rootEnded *time.Time
		var zoneResult, widgetResult, zonePlacement string
		if err := env.pool.QueryRow(context.Background(), `SELECT ended_at FROM playback_sessions WHERE activity_session_id=$1`, parent).Scan(&rootEnded); err != nil {
			t.Fatal(err)
		}
		if err := env.pool.QueryRow(context.Background(), `SELECT result,layout_placement_id FROM playback_sessions WHERE activity_session_id='zone-play'`).Scan(&zoneResult, &zonePlacement); err != nil {
			t.Fatal(err)
		}
		if err := env.pool.QueryRow(context.Background(), `SELECT result FROM playback_sessions WHERE activity_session_id='widget-play'`).Scan(&widgetResult); err != nil {
			t.Fatal(err)
		}
		if rootEnded != nil || zoneResult != "completed" || zonePlacement != "playlist-zone-a" || widgetResult != "failed" {
			t.Fatalf("rootEnded=%v zone=%s placement=%s widget=%s", rootEnded, zoneResult, zonePlacement, widgetResult)
		}
	})
}

func TestPlaybackGapAppearsInOverviewAndClosesProofUnknown(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		now := time.Now().UTC().Truncate(time.Microsecond)
		postActivityBatch(t, env, playerActivityBatchInput{Events: []playerActivityEventInput{
			{ID: uuid.New(), Sequence: 1, EventType: "presentation.started", OccurredAt: now.Add(-10 * time.Minute), PlayerTimezone: "UTC", PresentationType: "playlist", PresentationID: "morning-announcements", ActivitySessionID: "gap-root", Result: "playing"},
			{ID: uuid.New(), Sequence: 2, EventType: "heartbeat.gap_detected", OccurredAt: now.Add(-5 * time.Minute), PlayerTimezone: "UTC", Result: "unknown", FailureCode: "heartbeat_gap", FailureMessage: "Player reporting stopped for more than three minutes."},
			{ID: uuid.New(), Sequence: 3, EventType: "connection.restored", OccurredAt: now.Add(-time.Minute), PlayerTimezone: "UTC", Result: "recovered"},
		}}, http.StatusAccepted)

		var result string
		var endedAt time.Time
		if err := env.pool.QueryRow(context.Background(), `SELECT result,ended_at FROM playback_sessions WHERE activity_session_id='gap-root'`).Scan(&result, &endedAt); err != nil {
			t.Fatal(err)
		}
		if result != "unknown" || endedAt.IsZero() {
			t.Fatalf("gap session result=%q endedAt=%v", result, endedAt)
		}

		request := httptest.NewRequest(http.MethodGet, "/api/v1/activity/overview?range=24h", nil)
		request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, env.owner))
		response := httptest.NewRecorder()
		env.server.activityOverview(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("overview status=%d body=%s", response.Code, response.Body.String())
		}
		var envelope struct {
			Data activityOverviewData `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Data.Cards.ScreensWithPlaybackGaps != 1 {
			t.Fatalf("playback gaps=%d overview=%s", envelope.Data.Cards.ScreensWithPlaybackGaps, response.Body.String())
		}
	})
}

func TestAuditFilteringRedactionAndCSV(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		auditID := uuid.New()
		_, err := env.pool.Exec(context.Background(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id,resource_name,result,ip_address,request_id,summary,metadata,metadata_sensitive) VALUES($1,$2,'layouts.published','layout',$3,'Morning Layout','success','192.0.2.10','request-1','Activity Owner published Morning Layout','{"revision":4,"diagnosticPayload":"private"}'::jsonb,TRUE)`, auditID, env.owner.User.ID, uuid.NewString())
		if err != nil {
			t.Fatal(err)
		}
		editor := auth.Session{User: auth.User{ID: uuid.New(), Role: "editor", Active: true}}
		request := httptest.NewRequest(http.MethodGet, "/api/v1/activity/audit?resourceType=layout&search=Morning", nil)
		request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, editor))
		response := httptest.NewRecorder()
		env.server.listAuditActivity(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("audit status=%d body=%s", response.Code, response.Body.String())
		}
		var envelope struct {
			Data auditActivityPage `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || len(envelope.Data.Items) != 1 {
			t.Fatalf("audit response=%s err=%v", response.Body.String(), err)
		}
		item := envelope.Data.Items[0]
		if item.IPAddress != "" || item.RequestID != "" || item.Metadata["redacted"] != true {
			t.Fatalf("editor saw sensitive audit data: %#v", item)
		}

		exportRequest := httptest.NewRequest(http.MethodGet, "/api/v1/activity/audit/export.csv?resourceType=layout", nil)
		exportRequest = exportRequest.WithContext(context.WithValue(exportRequest.Context(), sessionContextKey, env.owner))
		exportResponse := httptest.NewRecorder()
		env.server.exportAuditActivity(exportResponse, exportRequest)
		if exportResponse.Code != http.StatusOK || !strings.Contains(exportResponse.Body.String(), "Morning Layout") || !strings.Contains(exportResponse.Body.String(), "Timestamp,Actor") {
			t.Fatalf("audit CSV=%d %s", exportResponse.Code, exportResponse.Body.String())
		}
	})
}

func TestDateAwareProofAttributionAndAuditRedaction(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		event := playerActivityEventInput{ID: uuid.New(), Sequence: 1, EventType: "data_widget.activated", OccurredAt: time.Now().UTC(), PlayerTimezone: "UTC", PresentationType: "layout", PresentationID: "cafeteria", ContentType: "widget", ContentID: "menu-widget", LayoutPlacementID: "menu-placement", ActivitySessionID: "menu-session", Result: "playing", SourceID: "lunch-menu", SelectedRecordID: "2026-07-15-lunch", SelectionDate: "2026-07-15", SourceCachedAt: timePointer(time.Now().UTC().Add(-time.Minute)), SourceRevision: "rev-8", SnapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
		postActivityBatch(t, env, playerActivityBatchInput{Events: []playerActivityEventInput{event}}, http.StatusAccepted)
		var recordID, sourceID, snapshot string
		if err := env.pool.QueryRow(context.Background(), `SELECT selected_record_id,source_id,snapshot_hash FROM playback_sessions WHERE activity_session_id='menu-session'`).Scan(&recordID, &sourceID, &snapshot); err != nil {
			t.Fatal(err)
		}
		if recordID != "2026-07-15-lunch" || sourceID != "lunch-menu" || len(snapshot) != 64 {
			t.Fatalf("attribution=%s %s %s", recordID, sourceID, snapshot)
		}
		clean := sanitizeActivityMap(map[string]any{"password": "never", "safe": "shown", "nested": map[string]any{"sessionToken": "never", "field": "value"}}, false)
		if _, ok := clean["password"]; ok || clean["safe"] != "shown" {
			t.Fatalf("unsafe metadata=%#v", clean)
		}
		nested := clean["nested"].(map[string]any)
		if _, ok := nested["sessionToken"]; ok || nested["field"] != "value" {
			t.Fatalf("unsafe nested metadata=%#v", nested)
		}
	})
}

func TestActivityExportsAndRetentionRespectPermissions(t *testing.T) {
	withActivityDatabase(t, func(env activityTestEnvironment) {
		viewerRequest := httptest.NewRequest(http.MethodGet, "/api/v1/activity/proof-of-play/export.csv", nil)
		viewerRequest = viewerRequest.WithContext(context.WithValue(viewerRequest.Context(), sessionContextKey, auth.Session{User: auth.User{ID: uuid.New(), Role: "viewer"}}))
		viewerResponse := httptest.NewRecorder()
		env.server.exportProofOfPlay(viewerResponse, viewerRequest)
		if viewerResponse.Code != http.StatusForbidden {
			t.Fatalf("viewer export status=%d", viewerResponse.Code)
		}

		old := time.Now().UTC().Add(-400 * 24 * time.Hour)
		_, _ = env.pool.Exec(context.Background(), `INSERT INTO player_activity_events(id,screen_id,sequence,event_type,category,severity,occurred_at,player_timezone,result) VALUES($1,$2,1,'player.connected','connectivity','info',$3,'UTC','success')`, uuid.New(), env.screenID, old)
		_, _ = env.pool.Exec(context.Background(), `UPDATE activity_retention_settings SET raw_event_days=60`)
		env.server.cleanupActivityBounded(context.Background(), 500)
		var count int
		_ = env.pool.QueryRow(context.Background(), `SELECT count(*) FROM player_activity_events WHERE screen_id=$1 AND occurred_at=$2`, env.screenID, old).Scan(&count)
		if count != 0 {
			t.Fatalf("old activity events were not cleaned up")
		}
	})
}

func postActivityBatch(t *testing.T, env activityTestEnvironment, input playerActivityBatchInput, expected int) {
	t.Helper()
	body, _ := json.Marshal(input)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/player/activity-events", bytes.NewReader(body))
	request = request.WithContext(context.WithValue(request.Context(), deviceContextKey, devices.DevicePrincipal{ScreenID: env.screenID, Enabled: true}))
	response := httptest.NewRecorder()
	env.server.ingestPlayerActivity(response, request)
	if response.Code != expected {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func int64Pointer(value int64) *int64        { return &value }
func timePointer(value time.Time) *time.Time { return &value }
