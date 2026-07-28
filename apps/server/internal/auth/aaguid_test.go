package auth

import (
	"testing"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

func credentialWith(aaguid []byte, attachment protocol.AuthenticatorAttachment, transports ...protocol.AuthenticatorTransport) *webauthn.Credential {
	return &webauthn.Credential{
		Transport: transports,
		Authenticator: webauthn.Authenticator{
			AAGUID:     aaguid,
			Attachment: attachment,
		},
	}
}

// A user should never have to invent a name for a passkey; the authenticator
// already says what it is.
func TestDescribePasskeyNamesKnownProviders(t *testing.T) {
	onePassword := []byte{0xba, 0xda, 0x55, 0x66, 0xa7, 0xaa, 0x40, 0x1f, 0xbd, 0x96, 0x45, 0x61, 0x9a, 0x55, 0x12, 0x0d}
	if got := describePasskey(credentialWith(onePassword, protocol.CrossPlatform)); got != "1Password" {
		t.Fatalf("expected the provider name, got %q", got)
	}
}

// iCloud Keychain and several browsers report a zero AAGUID on purpose. That
// is not an error, and it must not produce a name like "00000000-...".
func TestDescribePasskeyFallsBackToAttachment(t *testing.T) {
	zero := make([]byte, 16)
	cases := []struct {
		name       string
		credential *webauthn.Credential
		want       string
	}{
		{"platform", credentialWith(zero, protocol.Platform), "This device"},
		{"security key", credentialWith(zero, protocol.CrossPlatform, protocol.USB), "Security key"},
		{"nfc key", credentialWith(zero, protocol.CrossPlatform, protocol.NFC), "Security key"},
		{"hybrid", credentialWith(zero, protocol.CrossPlatform, protocol.Hybrid), "Another device"},
		{"unreported", credentialWith(nil, ""), "Passkey"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := describePasskey(testCase.credential); got != testCase.want {
				t.Fatalf("got %q want %q", got, testCase.want)
			}
		})
	}
}

func TestFormatAAGUIDRejectsWrongLength(t *testing.T) {
	if got := formatAAGUID([]byte{1, 2, 3}); got != "" {
		t.Fatalf("expected an empty string for a malformed AAGUID, got %q", got)
	}
	full := []byte{0xfb, 0xfc, 0x30, 0x07, 0x15, 0x4e, 0x4e, 0xcc, 0x8c, 0x0b, 0x6e, 0x02, 0x05, 0x57, 0xd7, 0xbd}
	if got := formatAAGUID(full); got != "fbfc3007-154e-4ecc-8c0b-6e020557d7bd" {
		t.Fatalf("unexpected AAGUID formatting: %q", got)
	}
}

// Two passkeys from the same provider have to stay distinguishable, but the
// common case of one should not be numbered.
func TestUniquePasskeyName(t *testing.T) {
	if got := uniquePasskeyName("1Password", nil); got != "1Password" {
		t.Fatalf("the first passkey should not be numbered, got %q", got)
	}
	existing := []PasskeySummary{{Name: "1Password"}}
	if got := uniquePasskeyName("1Password", existing); got != "1Password (2)" {
		t.Fatalf("got %q want %q", got, "1Password (2)")
	}
	existing = append(existing, PasskeySummary{Name: "1Password (2)"})
	if got := uniquePasskeyName("1Password", existing); got != "1Password (3)" {
		t.Fatalf("got %q want %q", got, "1Password (3)")
	}
	// A user who renamed a passkey with different casing still collides.
	if got := uniquePasskeyName("Windows Hello", []PasskeySummary{{Name: "windows hello"}}); got != "Windows Hello (2)" {
		t.Fatalf("expected a case-insensitive collision, got %q", got)
	}
}
