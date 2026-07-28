package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

func TestPlayerHeartbeatAcceptsTakeoverAndCommandStatus(t *testing.T) {
	takeoverID := uuid.New()
	commandID := uuid.New()
	completedAt := time.Now().UTC().Truncate(time.Second)
	body := `{"screenWidth":1920,"screenHeight":1080,"playerVersion":"0.10.1","activeTakeoverId":"` + takeoverID.String() + `","takeoverState":"active","takeoverPreparationProgress":100,"playbackDisabled":false,"lastCommandId":"` + commandID.String() + `","lastCommandState":"succeeded","lastCommandResult":"playback_reloaded","lastCommandCompletedAt":"` + completedAt.Format(time.RFC3339) + `"}`
	request := httptest.NewRequest("POST", "/api/v1/player/heartbeat", strings.NewReader(body))
	var heartbeat devices.Heartbeat
	if err := decodeJSON(httptest.NewRecorder(), request, &heartbeat); err != nil {
		t.Fatal(err)
	}
	if heartbeat.ActiveTakeoverID == nil || *heartbeat.ActiveTakeoverID != takeoverID || heartbeat.TakeoverState != "active" || heartbeat.TakeoverPreparationProgress == nil || *heartbeat.TakeoverPreparationProgress != 100 {
		t.Fatalf("takeover status did not decode: %#v", heartbeat)
	}
	if heartbeat.PlaybackDisabled == nil || *heartbeat.PlaybackDisabled || heartbeat.LastCommandID == nil || *heartbeat.LastCommandID != commandID || heartbeat.LastCommandState != "succeeded" || heartbeat.LastCommandResult != "playback_reloaded" || heartbeat.LastCommandCompletedAt == nil || !heartbeat.LastCommandCompletedAt.Equal(completedAt) {
		t.Fatalf("command status did not decode: %#v", heartbeat)
	}
}

func TestDecodeHeartbeatTolerantlyKeepsLifecycleFieldsWhenAnItemIdentifierIsSynthetic(t *testing.T) {
	payload := []byte(`{"screenWidth":1920,"screenHeight":1080,"playerVersion":"0.2.6","playerVersionCode":2006,"lastHealthyPlaybackAt":"2026-07-27T12:00:00Z","playbackState":"playing","safeMode":false,"currentItemId":"layout-6ba7b810-9dad-11d1-80b4-00c04fd430c8"}`)
	heartbeat, dropped, err := decodeHeartbeatTolerantly(payload)
	if err != nil {
		t.Fatalf("heartbeat rejected: %v", err)
	}
	if !slices.Equal(dropped, []string{"currentItemId"}) {
		t.Fatalf("dropped = %v", dropped)
	}
	if heartbeat.CurrentItemID != nil {
		t.Fatalf("malformed identifier was not dropped: %v", heartbeat.CurrentItemID)
	}
	if heartbeat.PlayerVersionCode == nil || *heartbeat.PlayerVersionCode != 2006 {
		t.Fatalf("player version code lost: %#v", heartbeat.PlayerVersionCode)
	}
	if heartbeat.LastHealthyPlaybackAt == nil || heartbeat.PlaybackState != "playing" || heartbeat.SafeMode == nil || *heartbeat.SafeMode {
		t.Fatalf("lifecycle fields lost: %#v", heartbeat)
	}
}

func TestDecodeHeartbeatTolerantlyRejectsMalformedDeploymentIdentifier(t *testing.T) {
	payload := []byte(`{"screenWidth":1920,"screenHeight":1080,"playerVersionCode":2006,"currentUpdateDeploymentId":"deployment-1"}`)
	if _, dropped, err := decodeHeartbeatTolerantly(payload); err == nil || dropped != nil {
		t.Fatalf("deployment identifier was salvaged: dropped=%v err=%v", dropped, err)
	}
}

func TestDecodeHeartbeatTolerantlyRejectsMalformedTimestamp(t *testing.T) {
	payload := []byte(`{"screenWidth":1920,"lastCommandCompletedAt":"not-a-time"}`)
	if _, _, err := decodeHeartbeatTolerantly(payload); err == nil {
		t.Fatal("malformed timestamp was accepted")
	}
}

func TestHeartbeatPayloadInvalidFieldsNamesOnlyMalformedFields(t *testing.T) {
	payload := json.RawMessage(`{"screenWidth":1920,"screenHeight":1080,"playerVersion":"0.2.2","currentItemId":"layout:item","lastCommandCompletedAt":"not-a-time"}`)
	fields := heartbeatPayloadInvalidFields(payload)
	if !slices.Equal(fields, []string{"currentItemId", "lastCommandCompletedAt"}) {
		t.Fatalf("invalid fields = %v", fields)
	}
}
