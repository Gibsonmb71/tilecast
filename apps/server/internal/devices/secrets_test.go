package devices

import "testing"

func TestPairingCodeGenerationAndNormalization(t *testing.T) {
	code, err := GeneratePairingCode()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatalf("unexpected code %q", code)
	}
	if normalized, err := NormalizePairingCode(" " + code[:3] + "-" + code[3:] + " "); err != nil || normalized != code {
		t.Fatalf("normalization failed: %q %v", normalized, err)
	}
	for _, invalid := range []string{"ABC", "ABC0EF", "ABCIJK", "ABCDEF7"} {
		if _, err := NormalizePairingCode(invalid); err == nil {
			t.Fatalf("expected %q to be invalid", invalid)
		}
	}
}

func TestSecretHashAndConstantTimeMatch(t *testing.T) {
	hash := secretHash("correct-secret")
	if !secretMatches(hash, "correct-secret") || secretMatches(hash, "wrong-secret") {
		t.Fatal("secret comparison failed")
	}
}

func TestDeviceCredentialRoundTrip(t *testing.T) {
	publicID, secret, credential, err := newDeviceCredential()
	if err != nil {
		t.Fatal(err)
	}
	gotID, gotSecret, err := ParseDeviceCredential(credential)
	if err != nil || gotID != publicID || gotSecret != secret {
		t.Fatalf("parse failed: %q %q %v", gotID, gotSecret, err)
	}
	if _, _, err := ParseDeviceCredential("dashboard-session-token"); err == nil {
		t.Fatal("dashboard token must not parse as a device credential")
	}
}
