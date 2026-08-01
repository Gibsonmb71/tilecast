package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/airplay"
)

func validAirplayCommandPayload() map[string]any {
	sessionID := uuid.NewString()
	targetID := uuid.NewString()
	gatewayID := uuid.NewString()
	return map[string]any{
		"provider":        "airplay",
		"sessionId":       sessionID,
		"role":            "gateway",
		"phase":           "prepare",
		"targetType":      "group",
		"targetId":        targetID,
		"gatewayScreenId": gatewayID,
		"audioScreenId":   gatewayID,
		"receiverName":    "HS Cafeteria",
		"pin":             "4821",
		"deviceId":        "02:11:22:33:44:55",
		"expiresAt":       "2030-01-01T00:00:00Z",
		"transport":       "unicast",
		"videoPort":       float64(airplay.VideoPort),
		"audioPort":       float64(airplay.AudioPort),
		"destinations": []any{
			map[string]any{
				"screenId": gatewayID,
				"host":     "127.0.0.1",
				"port":     float64(airplay.VideoPort),
			},
		},
		"profile":   "720p30",
		"audioMode": "gateway_only",
	}
}

func TestValidateAirplayCommandPayloadRejectsUnsafeOrAmbiguousFields(t *testing.T) {
	tests := []struct {
		name   string
		change func(map[string]any)
	}{
		{
			name: "invalid phase",
			change: func(payload map[string]any) {
				payload["phase"] = "shell"
			},
		},
		{
			name: "invalid pin",
			change: func(payload map[string]any) {
				payload["pin"] = "12345"
			},
		},
		{
			name: "non local device identity",
			change: func(payload map[string]any) {
				payload["deviceId"] = "00:11:22:33:44:55"
			},
		},
		{
			name: "pipeline delimiter in host",
			change: func(payload map[string]any) {
				payload["destinations"].([]any)[0].(map[string]any)["host"] = "127.0.0.1,udpsink"
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload := validAirplayCommandPayload()
			test.change(payload)
			if err := validateAirplayCommandPayload("prepare_airplay_session", payload); err == nil {
				t.Fatal("expected invalid AirPlay payload")
			}
		})
	}
}

func TestValidateAirplayCommandPayloadAcceptsMulticastAndStop(t *testing.T) {
	payload := validAirplayCommandPayload()
	payload["transport"] = "multicast"
	payload["multicastAddress"] = "239.255.42.7"
	if err := validateAirplayCommandPayload("prepare_airplay_session", payload); err != nil {
		t.Fatalf("multicast payload rejected: %v", err)
	}
	if err := validateAirplayCommandPayload("stop_airplay_session", map[string]any{
		"sessionId": payload["sessionId"],
		"reason":    "manual_stop",
	}); err != nil {
		t.Fatalf("stop payload rejected: %v", err)
	}
}
