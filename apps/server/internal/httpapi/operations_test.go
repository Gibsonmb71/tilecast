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
	for _, input := range []struct{ typ, body string }{
		{"shell", `{}`},
		{"sync_now", `{"url":"https://example.com"}`},
		{"identify_screen", `{"durationSeconds":121}`},
		{"identify_screen", `{"durationSeconds":30,"extra":1}`},
	} {
		if _, err := s.validateCommand(input.typ, json.RawMessage(input.body)); err == nil {
			t.Fatalf("expected %s payload to be rejected", input.typ)
		}
	}
}
