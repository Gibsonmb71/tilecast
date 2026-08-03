// Package presentnet owns Presentation Network records: reusable
// organization-level Wi-Fi definitions that an assigned Linux player joins
// temporarily on its Wi-Fi adapter while AirPlay Present is running.
//
// The security posture in one place, because every file here depends on all of
// it:
//
//   - A Wi-Fi PSK or Enterprise password is a real secret. It is never stored in
//     cleartext, never returned by a Studio read, never placed in audit
//     metadata, never written to a durable player command payload, never logged,
//     and never passed in a process argument.
//   - Sealing uses AES-256-GCM with a random nonce under a key that lives only
//     in the environment (TILECAST_PRESENTATION_NETWORK_KEY), so the ciphertext
//     in PostgreSQL — and therefore in every database backup — is useless on its
//     own. The key must be backed up separately and must never be placed inside
//     a Tilecast backup.
//   - The sealed envelope is bound with AAD to the organization and network
//     identifiers, so a ciphertext lifted from one row cannot be replayed into
//     another one.
//   - A key that cannot open an existing envelope fails closed. Tilecast reports
//     that the credential must be re-entered; it never prints the ciphertext, a
//     key fingerprint, or any part of the plaintext in the error.
package presentnet

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// KeyEnvironmentVariable is the only place the sealing key comes from. It is
// deliberately not a setting: a value stored through Studio would become a
// recoverable secret in the schema, in every backup, and in the configuration
// export, which is exactly what this envelope exists to prevent.
const KeyEnvironmentVariable = "TILECAST_PRESENTATION_NETWORK_KEY"

// envelopeVersion is the first byte after the magic. It exists so a future
// construction can be introduced without guessing at the layout of bytes
// written by an older server.
const envelopeVersion = 1

// envelopeMagic makes a mis-typed column or a truncated restore fail loudly
// instead of being handed to a cipher as if it were a nonce.
var envelopeMagic = []byte("TCPN")

var (
	// ErrKeyNotConfigured means the installation has no sealing key. The server
	// still starts and every other feature keeps working; only creating or
	// provisioning a Presentation Network credential is unavailable.
	ErrKeyNotConfigured = errors.New("presentation network encryption key is not configured")
	// ErrSecretUnreadable means the configured key cannot open a stored
	// envelope. This is a fail-closed outcome: the credential must be re-entered.
	ErrSecretUnreadable = errors.New("stored presentation network credential could not be decrypted with the configured key")
	// ErrKeyInvalid means the environment value is present but unusable.
	ErrKeyInvalid = errors.New(KeyEnvironmentVariable + " must be 32 bytes encoded as base64 or hex")
)

// KeyUnavailableMessage is the operator-facing explanation Studio and the player
// API return when no key is configured. It names the variable and the
// consequence, and it is safe to show to anyone who can already manage settings.
const KeyUnavailableMessage = "Presentation Network credentials are unavailable because " +
	KeyEnvironmentVariable + " is not set on the Tilecast server. Set it to a 32-byte " +
	"base64 or hex value, back it up outside Tilecast, and restart the server."

// Cipher seals and opens Presentation Network credentials. A nil *Cipher is the
// legitimate "no key configured" state, and every method on it returns
// ErrKeyNotConfigured rather than panicking, so the absence of a key is a
// feature-level limitation instead of a startup failure.
type Cipher struct {
	aead cipher.AEAD
}

// LoadCipher reads the sealing key from a raw environment value. An empty value
// yields (nil, nil): the caller is expected to keep running without the
// capability. A present but malformed value is an error, because silently
// ignoring a key an operator believed they had configured would leave them
// thinking credentials were protected when the feature was simply off.
func LoadCipher(raw string) (*Cipher, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	key, err := decodeKey(raw)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrKeyInvalid
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrKeyInvalid
	}
	return &Cipher{aead: aead}, nil
}

// decodeKey accepts the three encodings an operator plausibly produces:
// `openssl rand -base64 32`, `openssl rand -hex 32`, and the URL-safe base64
// some secret managers emit. Anything that does not decode to exactly 32 bytes
// is rejected rather than stretched or truncated.
func decodeKey(raw string) ([]byte, error) {
	if len(raw) == 64 {
		if decoded, err := hex.DecodeString(raw); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding,
		base64.URLEncoding, base64.RawURLEncoding,
	} {
		if decoded, err := encoding.DecodeString(raw); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	return nil, ErrKeyInvalid
}

// Configured reports whether sealing is available. Callers use this to present a
// clear limitation instead of attempting an operation that cannot succeed.
func (c *Cipher) Configured() bool { return c != nil && c.aead != nil }

// aad binds a ciphertext to the row that holds it. Both identifiers are
// included: the organization because an installation is one organization and a
// restored database should not be able to lend its ciphertext to another one,
// and the network because moving an envelope between two networks in the same
// organization would otherwise substitute one credential for another.
func aad(organizationID, networkID uuid.UUID) []byte {
	return []byte("tilecast.presentation-network.v1|" + organizationID.String() + "|" + networkID.String())
}

// Seal produces the opaque envelope stored in presentation_networks.
//
// Layout: magic("TCPN") || version(1) || nonce(12) || ciphertext+tag. The nonce
// is fresh for every seal, so rotating a credential to the same value still
// produces different bytes and a database observer learns nothing from equality.
func (c *Cipher) Seal(organizationID, networkID uuid.UUID, plaintext []byte) ([]byte, error) {
	if !c.Configured() {
		return nil, ErrKeyNotConfigured
	}
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("generate presentation network nonce: %w", err)
	}
	header := append(append([]byte(nil), envelopeMagic...), envelopeVersion)
	sealed := c.aead.Seal(nil, nonce, plaintext, aad(organizationID, networkID))
	return append(append(header, nonce...), sealed...), nil
}

// Open reverses Seal. Every failure — wrong key, wrong row, truncated column,
// tampered bytes — collapses to ErrSecretUnreadable on purpose: the caller's
// only correct response is to ask for the credential again, and distinguishing
// the causes in an error message would describe the stored bytes.
func (c *Cipher) Open(organizationID, networkID uuid.UUID, envelope []byte) ([]byte, error) {
	if !c.Configured() {
		return nil, ErrKeyNotConfigured
	}
	header := len(envelopeMagic) + 1
	if len(envelope) < header+c.aead.NonceSize() {
		return nil, ErrSecretUnreadable
	}
	if string(envelope[:len(envelopeMagic)]) != string(envelopeMagic) {
		return nil, ErrSecretUnreadable
	}
	if envelope[len(envelopeMagic)] != envelopeVersion {
		return nil, ErrSecretUnreadable
	}
	nonce := envelope[header : header+c.aead.NonceSize()]
	plaintext, err := c.aead.Open(nil, nonce, envelope[header+c.aead.NonceSize():], aad(organizationID, networkID))
	if err != nil {
		return nil, ErrSecretUnreadable
	}
	return plaintext, nil
}

// EnvelopeVersion is recorded alongside the ciphertext so a future migration can
// find rows written by an older construction without opening them.
func EnvelopeVersion() int { return envelopeVersion }
