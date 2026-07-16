package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONLimitAllowsBoundedLargePayload(t *testing.T) {
	payload := "{\"content\":\"" + strings.Repeat("a", 1<<20) + "\"}"
	request := httptest.NewRequest("POST", "/api/v1/data-sources", strings.NewReader(payload))
	var target struct {
		Content string `json:"content"`
	}

	if err := decodeJSONLimit(httptest.NewRecorder(), request, &target, 2<<20); err != nil {
		t.Fatalf("decode bounded large JSON: %v", err)
	}
	if len(target.Content) != 1<<20 {
		t.Fatalf("decoded content length = %d, want %d", len(target.Content), 1<<20)
	}
}
