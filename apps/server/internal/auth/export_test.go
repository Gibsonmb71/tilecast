package auth

import (
	"encoding/base32"
	"testing"
	"time"
)

// TestingTOTPCode computes the code an authenticator app would show for a
// base32 secret, so integration tests can complete a real enrollment.
func TestingTOTPCode(t testing.TB, secret string, at time.Time) string {
	t.Helper()
	raw, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	if err != nil {
		t.Fatalf("decode authenticator secret: %v", err)
	}
	return totpCode(raw, at.Unix()/int64(totpPeriod.Seconds()))
}
