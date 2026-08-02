package httpapi

import (
	"encoding/json"
	"testing"
)

func TestCommandPayloadValidation(t *testing.T) {
	s := &server{operations: OperationsConfig{MaxIdentifySeconds: 120}}
	if _, err := s.validateCommand("sync_now", json.RawMessage(`{}`)); err != nil {
		t.Fatalf("sync command: %v", err)
	}
	if _, err := s.validateCommand("identify_screen", json.RawMessage(`{"durationSeconds":30}`)); err != nil {
		t.Fatalf("identify command: %v", err)
	}
	for _, command := range []string{"retry_player_recovery", "exit_safe_mode", "power_assist_sleep", "power_assist_wake", "retry_current_item", "skip_current_item", "recreate_renderer", "recreate_playback_session", "restart_activity", "restart_player_process", "resynchronize_player", "run_player_self_test", "install_autostart", "remove_autostart"} {
		if _, err := s.validateCommand(command, json.RawMessage(`{}`)); err != nil {
			t.Fatalf("%s command: %v", command, err)
		}
	}
	for _, input := range []struct {
		typ  string
		body string
	}{
		{"display_power_on", `{}`},
		{"display_set_input", `{"input":"1.0.0.0"}`},
		{"display_set_volume", `{"volume":50}`},
		{"display_set_brightness", `{"brightness":75}`},
	} {
		if _, err := s.validateCommand(input.typ, json.RawMessage(input.body)); err != nil {
			t.Fatalf("%s command: %v", input.typ, err)
		}
	}
	for _, input := range []struct{ typ, body string }{
		{"shell", `{}`},
		{"sync_now", `{"url":"https://example.com"}`},
		{"identify_screen", `{"durationSeconds":121}`},
		{"identify_screen", `{"durationSeconds":30,"extra":1}`},
		{"display_set_volume", `{"volume":101}`},
		{"display_set_input", `{"input":"1; reboot"}`},
	} {
		if _, err := s.validateCommand(input.typ, json.RawMessage(input.body)); err == nil {
			t.Fatalf("expected %s payload to be rejected", input.typ)
		}
	}
}

func TestNormalizedCanarySize(t *testing.T) {
	for _, test := range []struct {
		requested int
		targets   int
		want      int
	}{{0, 10, 0}, {2, 10, 2}, {10, 10, 0}, {11, 10, 0}} {
		if got := normalizedCanarySize(test.requested, test.targets); got != test.want {
			t.Fatalf("normalizedCanarySize(%d,%d)=%d, want %d", test.requested, test.targets, got, test.want)
		}
	}
}
