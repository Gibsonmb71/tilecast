package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestPairingJSONContracts(t *testing.T) {
	tests := []struct {
		name string
		body string
		new  func() any
	}{
		{"android create pairing", `{"installationId":"server-id","metadata":{"playerInstallationId":"` + uuid.NewString() + `","platform":"android-tv","manufacturer":"Amazon","model":"Fire TV","androidVersion":"11","playerVersion":"0.10.1","screenWidth":1920,"screenHeight":1080,"density":1.5,"locale":"en-US","timezone":"America/New_York"}}`, func() any { return &createPairingRequest{} }},
		{"pairing lookup", `{"code":"ABC234"}`, func() any {
			return &struct {
				Code string `json:"code"`
			}{}
		}},
		{"studio repair approval", `{"name":"Cafeteria Display","locationId":null,"roomName":"Cafeteria","roomNumber":"","description":"","replaceExistingCredential":true}`, func() any { return &approvePairingRequest{} }},
		{"android enrollment", `{"pairingSessionId":"` + uuid.NewString() + `","enrollmentToken":"private-token"}`, func() any { return &enrollmentRequest{} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/v1/test", strings.NewReader(test.body))
			if err := decodeJSON(httptest.NewRecorder(), r, test.new()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPairingJSONErrorsAreActionable(t *testing.T) {
	tests := []struct{ body, want string }{
		{"", "Request body is missing."},
		{"{", "Request body contains malformed JSON."},
		{`{"name":"Display","locationId":null,"roomName":"","roomNumber":"","description":"","replaceCredential":true}`, "Unsupported request field: replaceCredential."},
		{`{} {}`, "Request body must contain one JSON object."},
	}
	for _, test := range tests {
		r := httptest.NewRequest("POST", "/api/v1/screens/pairing/id/approve", strings.NewReader(test.body))
		err := decodeJSON(httptest.NewRecorder(), r, &approvePairingRequest{})
		if err == nil || err.Error() != test.want {
			t.Fatalf("body=%q error=%v want=%q", test.body, err, test.want)
		}
	}
}
