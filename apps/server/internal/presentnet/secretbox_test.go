package presentnet

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestCipherBindsEnvelopeToOrganizationAndNetwork(t *testing.T) {
	cipher, err := LoadCipher(strings.Repeat("ab", 32))
	if err != nil {
		t.Fatal(err)
	}
	organizationID := uuid.New()
	networkID := uuid.New()
	plaintext := []byte(`{"psk":"test-only-presentation-secret"}`)
	envelope, err := cipher.Seal(organizationID, networkID, plaintext)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(envelope, []byte("test-only-presentation-secret")) {
		t.Fatal("sealed envelope contains the plaintext credential")
	}
	opened, err := cipher.Open(organizationID, networkID, envelope)
	if err != nil || !bytes.Equal(opened, plaintext) {
		t.Fatalf("opened=%q err=%v, want original plaintext", opened, err)
	}
	for _, wrong := range [][2]uuid.UUID{
		{uuid.New(), networkID},
		{organizationID, uuid.New()},
	} {
		if _, err := cipher.Open(wrong[0], wrong[1], envelope); !errors.Is(err, ErrSecretUnreadable) {
			t.Fatalf("wrong AAD error=%v, want ErrSecretUnreadable", err)
		}
	}
}

func TestLoadCipherRejectsMalformedPresentKeyAndSupportsHex(t *testing.T) {
	if _, err := LoadCipher("not-a-key"); !errors.Is(err, ErrKeyInvalid) {
		t.Fatalf("malformed key error=%v, want ErrKeyInvalid", err)
	}
	cipher, err := LoadCipher(strings.Repeat("01", 32))
	if err != nil || !cipher.Configured() {
		t.Fatalf("hex key cipher=%v err=%v, want configured cipher", cipher, err)
	}
	var unavailable *Cipher
	if unavailable.Configured() {
		t.Fatal("nil cipher reported configured")
	}
	if _, err := unavailable.Seal(uuid.New(), uuid.New(), []byte("secret")); !errors.Is(err, ErrKeyNotConfigured) {
		t.Fatalf("missing key seal error=%v, want ErrKeyNotConfigured", err)
	}
}
