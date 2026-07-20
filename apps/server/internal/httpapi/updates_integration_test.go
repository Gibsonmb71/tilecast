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
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

func TestCreateUpdateDeploymentPersistsHistoryAndCommand(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings,users CASCADE`); err != nil {
		t.Fatal(err)
	}

	organizationID := uuid.New()
	userID := uuid.New()
	screenID := uuid.New()
	releaseID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(true,'Update Test',$1)`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,username,password_hash,role) VALUES($1,'Owner','owner','test','owner')`, userID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone,last_heartbeat_at) VALUES($1,$2,$3,'Lobby','android-tv','Test','Test','14','0.10.0',1920,1080,1,'en-US','UTC',now())`, screenID, organizationID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO screen_player_status(screen_id,player_version_code,android_sdk,install_permission_status) VALUES($1,10,35,'granted')`, screenID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO player_releases(id,source,channel,version_code,version_name,application_id,minimum_sdk,release_notes,published_at,apk_name,apk_size,apk_sha256,signing_certificate_sha256,manifest,manifest_signature,cache_status,verification_status,imported_by) VALUES($1,'upload','stable',11,'0.11.0','org.tilecast.player',23,'',now(),'tilecast-player.apk',1024,$2,$3,'{}'::jsonb,'signature','cached','verified',$4)`, releaseID, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", userID); err != nil {
		t.Fatal(err)
	}

	s := &server{
		db:      pool,
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		devices: devices.NewService(pool, devices.NewPresenceHub(), "http://localhost"),
	}
	requestBody, err := json.Marshal(deploymentInput{
		ReleaseID: releaseID,
		Name:      "Tilecast Player 0.11.0",
		Mode:      "install_now",
		ScreenIDs: []uuid.UUID{screenID},
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/update-deployments", bytes.NewReader(requestBody))
	request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, auth.Session{User: auth.User{ID: userID, Role: "owner"}}))
	response := httptest.NewRecorder()
	s.createUpdateDeployment(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}

	var created struct {
		Data struct {
			ID          uuid.UUID `json:"id"`
			TargetCount int       `json:"targetCount"`
		} `json:"data"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Data.ID == uuid.Nil || created.Data.TargetCount != 1 {
		t.Fatalf("unexpected create response: %#v", created.Data)
	}

	var commandPayload map[string]any
	if err = pool.QueryRow(ctx, `SELECT payload FROM player_commands WHERE screen_id=$1 AND type='install_player_update'`, screenID).Scan(&commandPayload); err != nil {
		t.Fatalf("read player command: %v", err)
	}
	if commandPayload["deploymentId"] != created.Data.ID.String() || commandPayload["releaseId"] != releaseID.String() {
		t.Fatalf("unexpected command payload: %#v", commandPayload)
	}
	var state string
	if err = pool.QueryRow(ctx, `SELECT state FROM screen_update_states WHERE deployment_id=$1 AND screen_id=$2`, created.Data.ID, screenID).Scan(&state); err != nil || state != "pending" {
		t.Fatalf("screen update state=%q err=%v", state, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE screen_update_states SET state='failed',safe_error='installer_conflict' WHERE deployment_id=$1 AND screen_id=$2`, created.Data.ID, screenID); err != nil {
		t.Fatal(err)
	}

	historyResponse := httptest.NewRecorder()
	s.listUpdateDeployments(historyResponse, httptest.NewRequest(http.MethodGet, "/api/v1/update-deployments", nil))
	if historyResponse.Code != http.StatusOK {
		t.Fatalf("history status=%d body=%s", historyResponse.Code, historyResponse.Body.String())
	}
	var history struct {
		Data struct {
			Items []struct {
				ID          uuid.UUID `json:"id"`
				TargetCount int       `json:"targetCount"`
				LastFailure string    `json:"lastFailure"`
			} `json:"items"`
		} `json:"data"`
	}
	if err = json.Unmarshal(historyResponse.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history.Data.Items) != 1 || history.Data.Items[0].ID != created.Data.ID || history.Data.Items[0].TargetCount != 1 || history.Data.Items[0].LastFailure != "installer_conflict" {
		t.Fatalf("deployment missing from history: %#v", history.Data.Items)
	}
}

func TestLinuxDeploymentTargetsOnlyLinuxScreens(t *testing.T) {
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
	if _, err = pool.Exec(ctx, `TRUNCATE organization_settings,users CASCADE`); err != nil {
		t.Fatal(err)
	}

	organizationID := uuid.New()
	userID := uuid.New()
	linuxScreen := uuid.New()
	androidScreen := uuid.New()
	releaseID := uuid.New()
	if _, err = pool.Exec(ctx, `INSERT INTO organization_settings(singleton,organization_name,id) VALUES(true,'Linux Update Test',$1)`, organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,name,username,password_hash,role) VALUES($1,'Owner','owner','test','owner')`, userID); err != nil {
		t.Fatal(err)
	}
	screen := func(id uuid.UUID, name, platform string) {
		if _, err = pool.Exec(ctx, `INSERT INTO screens(id,organization_id,player_installation_id,name,platform,device_manufacturer,device_model,android_version,player_version,screen_width,screen_height,density,locale,timezone,last_heartbeat_at) VALUES($1,$2,$3,$4,$5,'Test','Test','','0.1.0',1920,1080,1,'en-US','UTC',now())`, id, organizationID, uuid.NewString(), name, platform); err != nil {
			t.Fatal(err)
		}
	}
	screen(linuxScreen, "Linux Lobby", "linux")
	screen(androidScreen, "Fire TV", "fire-tv")

	// A Linux release: no application_id / minimum_sdk, AppImage artifact name.
	if _, err = pool.Exec(ctx, `INSERT INTO player_releases(id,platform,source,channel,version_code,version_name,release_notes,published_at,apk_name,apk_size,apk_sha256,signing_certificate_sha256,manifest,manifest_signature,cache_status,verification_status,imported_by) VALUES($1,'linux','upload','stable',2000,'0.2.0','',now(),'tilecast-player.AppImage',4096,$2,'','{}'::jsonb,'signature','cached','verified',$3)`, releaseID, "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", userID); err != nil {
		t.Fatal(err)
	}

	s := &server{
		db:      pool,
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		devices: devices.NewService(pool, devices.NewPresenceHub(), "http://localhost"),
	}
	requestBody, _ := json.Marshal(deploymentInput{
		ReleaseID: releaseID,
		Name:      "Tilecast Player for Linux 0.2.0",
		Mode:      "install_now",
		ScreenIDs: []uuid.UUID{linuxScreen, androidScreen},
	})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/update-deployments", bytes.NewReader(requestBody))
	request = request.WithContext(context.WithValue(request.Context(), sessionContextKey, auth.Session{User: auth.User{ID: userID, Role: "owner"}}))
	response := httptest.NewRecorder()
	s.createUpdateDeployment(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status=%d body=%s", response.Code, response.Body.String())
	}
	var created struct {
		Data struct {
			ID          uuid.UUID `json:"id"`
			TargetCount int       `json:"targetCount"`
		} `json:"data"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	// Only the Linux screen is eligible even though both were targeted.
	if created.Data.TargetCount != 1 {
		t.Fatalf("expected 1 Linux target, got %d", created.Data.TargetCount)
	}
	var androidStates int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM screen_update_states WHERE deployment_id=$1 AND screen_id=$2`, created.Data.ID, androidScreen).Scan(&androidStates); err != nil {
		t.Fatal(err)
	}
	if androidStates != 0 {
		t.Fatalf("android screen must not be targeted by a Linux release, got %d states", androidStates)
	}
	var payload map[string]any
	if err = pool.QueryRow(ctx, `SELECT payload FROM player_commands WHERE screen_id=$1 AND type='install_player_update'`, linuxScreen).Scan(&payload); err != nil {
		t.Fatalf("linux screen missing install command: %v", err)
	}
	if payload["expectedArtifactSha256"] == nil {
		t.Fatalf("linux command payload missing expectedArtifactSha256: %#v", payload)
	}
}
