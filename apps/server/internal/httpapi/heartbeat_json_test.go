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

func TestPlayerHeartbeatAcceptsEmergencyAndCommandStatus(t *testing.T) {
	emergencyID := uuid.New()
	commandID := uuid.New()
	completedAt := time.Now().UTC().Truncate(time.Second)
	body := `{"screenWidth":1920,"screenHeight":1080,"playerVersion":"0.10.1","activeEmergencyId":"` + emergencyID.String() + `","emergencyState":"active","emergencyPreparationProgress":100,"playbackDisabled":false,"lastCommandId":"` + commandID.String() + `","lastCommandState":"succeeded","lastCommandResult":"playback_reloaded","lastCommandCompletedAt":"` + completedAt.Format(time.RFC3339) + `"}`
	request := httptest.NewRequest("POST", "/api/v1/player/heartbeat", strings.NewReader(body))
	var heartbeat devices.Heartbeat
	if err := decodeJSON(httptest.NewRecorder(), request, &heartbeat); err != nil {
		t.Fatal(err)
	}
	if heartbeat.ActiveEmergencyID == nil || *heartbeat.ActiveEmergencyID != emergencyID || heartbeat.EmergencyState != "active" || heartbeat.EmergencyPreparationProgress == nil || *heartbeat.EmergencyPreparationProgress != 100 {
		t.Fatalf("emergency status did not decode: %#v", heartbeat)
	}
	if heartbeat.PlaybackDisabled == nil || *heartbeat.PlaybackDisabled || heartbeat.LastCommandID == nil || *heartbeat.LastCommandID != commandID || heartbeat.LastCommandState != "succeeded" || heartbeat.LastCommandResult != "playback_reloaded" || heartbeat.LastCommandCompletedAt == nil || !heartbeat.LastCommandCompletedAt.Equal(completedAt) {
		t.Fatalf("command status did not decode: %#v", heartbeat)
	}
}

func TestHeartbeatPayloadInvalidFieldsNamesOnlyMalformedFields(t *testing.T) {
	payload := json.RawMessage(`{"screenWidth":1920,"screenHeight":1080,"playerVersion":"0.2.2","currentItemId":"layout:item","lastCommandCompletedAt":"not-a-time"}`)
	fields := heartbeatPayloadInvalidFields(payload)
	if !slices.Equal(fields, []string{"currentItemId", "lastCommandCompletedAt"}) {
		t.Fatalf("invalid fields = %v", fields)
	}
}
