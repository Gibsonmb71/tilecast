package presentnet

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Security is the authentication type of a Presentation Network. Only methods
// Tilecast has actually validated on managed school Wi-Fi are present. The type
// is open for extension — a later, tested EAP method is a new constant plus a
// migration — but nothing here pretends to support an untested method.
type Security string

const (
	// SecurityPSK is WPA2/WPA3 Personal.
	SecurityPSK Security = "wpa_psk"
	// SecurityEnterprisePEAP is WPA2-Enterprise with PEAP/MSCHAPv2, which is what
	// district staff networks in schools overwhelmingly use.
	SecurityEnterprisePEAP Security = "wpa_eap_peap_mschapv2"
)

// SupportedSecurity lists the validated authentication types in the order Studio
// presents them.
var SupportedSecurity = []Security{SecurityPSK, SecurityEnterprisePEAP}

// Enterprise reports whether this type needs 802.1X fields.
func (s Security) Enterprise() bool { return s == SecurityEnterprisePEAP }

// Label is the operator-facing name. Kept next to the constant so the server and
// its error messages cannot drift from what Studio shows.
func (s Security) Label() string {
	switch s {
	case SecurityPSK:
		return "WPA2/WPA3 Personal (PSK)"
	case SecurityEnterprisePEAP:
		return "WPA2-Enterprise (PEAP/MSCHAPv2)"
	}
	return string(s)
}

func (s Security) valid() bool {
	for _, candidate := range SupportedSecurity {
		if candidate == s {
			return true
		}
	}
	return false
}

// AuthMetadata is the non-secret half of an Enterprise configuration. Every
// field here is information a network administrator hands out: a service
// account's username, the outer identity to present in the clear, the public CA
// certificate, and the server name to require. None of it is a credential, so it
// is stored as ordinary JSON and returned by Studio reads.
//
// There is deliberately no free-form NetworkManager property map. Arbitrary
// property editing would turn a bounded, validated feature into a way to
// reconfigure a signage machine's networking from Studio.
type AuthMetadata struct {
	// Identity is the 802.1X username.
	Identity string `json:"identity,omitempty"`
	// AnonymousIdentity is the outer identity sent before the tunnel is up.
	AnonymousIdentity string `json:"anonymousIdentity,omitempty"`
	// CACertificatePEM is the public certificate authority chain, if the network
	// administrator requires the client to validate the RADIUS server.
	CACertificatePEM string `json:"caCertificatePem,omitempty"`
	// DomainSuffixMatch is NetworkManager's expected server-name check. It only
	// has meaning together with a CA certificate.
	DomainSuffixMatch string `json:"domainSuffixMatch,omitempty"`
}

// Network is the stored record. The credential is deliberately absent from this
// struct: nothing that reads a network for Studio, for audit, or for a player
// command has any business holding the plaintext.
type Network struct {
	ID            uuid.UUID    `json:"id"`
	Name          string       `json:"name"`
	SSID          string       `json:"ssid"`
	Hidden        bool         `json:"hidden"`
	Security      Security     `json:"security"`
	SecurityLabel string       `json:"securityLabel"`
	Auth          AuthMetadata `json:"auth"`
	// CredentialSet says a credential exists without saying anything about it.
	// Studio uses it to render "A credential is saved" and to make an empty
	// secret field mean "keep the existing one".
	CredentialSet   bool       `json:"credentialSet"`
	SecretUpdatedAt *time.Time `json:"secretUpdatedAt,omitempty"`
	ConfigRevision  int64      `json:"configRevision"`
	AssignedScreens int        `json:"assignedScreens"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

// Input is a validated create/update request. Secret is separated from the rest
// because it follows a different rule: absent means "keep what is stored", and
// present means "rotate and bump the revision".
type Input struct {
	Name     string
	SSID     string
	Hidden   bool
	Security Security
	Auth     AuthMetadata
	// Secret is the PSK or Enterprise password. nil means unchanged.
	Secret *string
}

// ValidationError carries a message that is safe to return to Studio verbatim.
// It never quotes a credential — only the reason a credential was rejected.
type ValidationError struct{ Message string }

func (e ValidationError) Error() string { return e.Message }

func invalid(format string, args ...any) error {
	return ValidationError{Message: fmt.Sprintf(format, args...)}
}

// AsValidationError reports whether err is a caller-fixable input problem.
func AsValidationError(err error) (ValidationError, bool) {
	var validation ValidationError
	if errors.As(err, &validation) {
		return validation, true
	}
	return ValidationError{}, false
}

const (
	maxNameLength     = 120
	maxSSIDBytes      = 32
	maxIdentityLength = 253
	maxDomainLength   = 253
	maxCACertificate  = 32 * 1024
	minPSKPassphrase  = 8
	maxPSKPassphrase  = 63
	pskHexKeyLength   = 64
	maxEnterprisePass = 128
)

var (
	// Identities are usernames, optionally in user@realm or DOMAIN\user form.
	// The set is restrictive on purpose: this value ends up in a NetworkManager
	// keyfile, and a control character or newline there is a way to inject a
	// second key.
	identityPattern = regexp.MustCompile(`^[A-Za-z0-9._@\\/+=-]{1,253}$`)
	// A hostname suffix, which is what NetworkManager's domain-suffix-match takes.
	domainPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)
	pskHexPattern = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

// printableASCII is the charset every value that reaches a NetworkManager
// keyfile must satisfy.
//
// This is a real, documented limitation rather than an oversight. The keyfile
// format is GKeyFile, whose string values carry their own escaping rules, and a
// non-ASCII SSID has to be written as a byte array instead of a string. Keeping
// the helper's writer simple and provably correct is worth more than accepting a
// non-ASCII SSID that Tilecast has never tested, so the boundary rejects it here
// — where an administrator sees a clear message in Studio — rather than in a
// root-owned helper on a signage box.
func printableASCII(value string) bool {
	for index := 0; index < len(value); index++ {
		if value[index] < 0x20 || value[index] > 0x7e {
			return false
		}
	}
	return true
}

// ValidateInput normalizes and checks a create/update request. `existing`
// reports whether a credential is already stored, which is what makes an absent
// secret legal on update and illegal on create.
func ValidateInput(input Input, credentialAlreadyStored bool) (Input, error) {
	input.Name = strings.Join(strings.Fields(input.Name), " ")
	if input.Name == "" {
		return Input{}, invalid("Give the Presentation Network a name.")
	}
	if utf8.RuneCountInString(input.Name) > maxNameLength {
		return Input{}, invalid("The name must be %d characters or fewer.", maxNameLength)
	}

	// SSIDs may legitimately contain spaces, and both leading and trailing
	// spaces are technically valid, but they are indistinguishable in a text
	// field and are far more often a paste artifact than a real network name.
	input.SSID = strings.Trim(input.SSID, " \t\r\n")
	switch {
	case input.SSID == "":
		return Input{}, invalid("Enter the Wi-Fi network name (SSID).")
	case len(input.SSID) > maxSSIDBytes:
		return Input{}, invalid("An SSID is at most %d bytes.", maxSSIDBytes)
	case !printableASCII(input.SSID):
		return Input{}, invalid("Tilecast supports printable ASCII SSIDs. This SSID contains characters Tilecast has not validated on a Linux player.")
	}

	if !input.Security.valid() {
		return Input{}, invalid("Choose a supported authentication type: %s or %s.",
			SecurityPSK.Label(), SecurityEnterprisePEAP.Label())
	}

	auth, err := validateAuth(input.Security, input.Auth)
	if err != nil {
		return Input{}, err
	}
	input.Auth = auth

	if input.Secret == nil {
		if !credentialAlreadyStored {
			if input.Security.Enterprise() {
				return Input{}, invalid("Enter the Enterprise account password.")
			}
			return Input{}, invalid("Enter the Wi-Fi password or PSK.")
		}
		return input, nil
	}
	secret := *input.Secret
	if err := validateSecret(input.Security, secret); err != nil {
		return Input{}, err
	}
	input.Secret = &secret
	return input, nil
}

func validateAuth(security Security, auth AuthMetadata) (AuthMetadata, error) {
	auth.Identity = strings.TrimSpace(auth.Identity)
	auth.AnonymousIdentity = strings.TrimSpace(auth.AnonymousIdentity)
	auth.DomainSuffixMatch = strings.TrimSpace(strings.ToLower(auth.DomainSuffixMatch))
	auth.CACertificatePEM = strings.TrimSpace(auth.CACertificatePEM)

	if !security.Enterprise() {
		// A PSK network has no 802.1X fields at all. Silently keeping values an
		// administrator typed before switching the type would provision a profile
		// that does not match what Studio displays.
		return AuthMetadata{}, nil
	}

	switch {
	case auth.Identity == "":
		return AuthMetadata{}, invalid("Enter the Enterprise identity (username).")
	case len(auth.Identity) > maxIdentityLength || !identityPattern.MatchString(auth.Identity):
		return AuthMetadata{}, invalid("The Enterprise identity may use letters, digits, and . _ @ \\ / + = - only.")
	}
	if auth.AnonymousIdentity != "" && (len(auth.AnonymousIdentity) > maxIdentityLength || !identityPattern.MatchString(auth.AnonymousIdentity)) {
		return AuthMetadata{}, invalid("The anonymous identity may use letters, digits, and . _ @ \\ / + = - only.")
	}
	if auth.CACertificatePEM != "" {
		normalized, err := normalizeCertificatePEM(auth.CACertificatePEM)
		if err != nil {
			return AuthMetadata{}, err
		}
		auth.CACertificatePEM = normalized
	}
	if auth.DomainSuffixMatch != "" {
		if len(auth.DomainSuffixMatch) > maxDomainLength || !domainPattern.MatchString(auth.DomainSuffixMatch) {
			return AuthMetadata{}, invalid("The expected server domain must be a hostname such as radius.example.org.")
		}
		if auth.CACertificatePEM == "" {
			// NetworkManager can only check the server name against a certificate
			// it is able to validate. Accepting the field without a CA would show
			// an administrator a protection that is not in effect.
			return AuthMetadata{}, invalid("An expected server domain also needs the CA certificate that signs it.")
		}
	}
	return auth, nil
}

// normalizeCertificatePEM accepts only concatenated CERTIFICATE blocks. A private
// key, a certificate request, or arbitrary text is rejected: this value is
// written to a file the root helper hands to NetworkManager, and it must be
// exactly what it claims to be.
func normalizeCertificatePEM(value string) (string, error) {
	if len(value) > maxCACertificate {
		return "", invalid("The CA certificate must be %d KB or smaller.", maxCACertificate/1024)
	}
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	trimmed := strings.TrimSpace(value)
	if !strings.HasPrefix(trimmed, "-----BEGIN CERTIFICATE-----") {
		return "", invalid("Paste the CA certificate in PEM form, beginning with -----BEGIN CERTIFICATE-----.")
	}
	blocks := 0
	for _, line := range strings.Split(trimmed, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case line == "":
			continue
		case line == "-----BEGIN CERTIFICATE-----":
			blocks++
		case line == "-----END CERTIFICATE-----":
		case strings.HasPrefix(line, "-----"):
			return "", invalid("The CA certificate must contain certificates only, not keys or requests.")
		default:
			// Base64 body. Anything outside the alphabet means this is not a PEM
			// certificate, whatever its header claimed.
			for index := 0; index < len(line); index++ {
				c := line[index]
				if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '=') {
					return "", invalid("The CA certificate contains characters that are not valid PEM.")
				}
			}
		}
	}
	if blocks == 0 || !strings.HasSuffix(trimmed, "-----END CERTIFICATE-----") {
		return "", invalid("The CA certificate is incomplete; include the full -----END CERTIFICATE----- line.")
	}
	return trimmed + "\n", nil
}

// validateSecret bounds the credential. The messages describe the rule, never
// the value: an error that echoed part of a password would put it in a response
// body, a browser console, and a proxy log.
func validateSecret(security Security, secret string) error {
	if secret == "" {
		return invalid("Enter a credential, or leave the field blank to keep the saved one.")
	}
	if !printableASCII(secret) {
		return invalid("The credential must use printable ASCII characters.")
	}
	if security.Enterprise() {
		if len(secret) > maxEnterprisePass {
			return invalid("The Enterprise password must be %d characters or fewer.", maxEnterprisePass)
		}
		return nil
	}
	if pskHexPattern.MatchString(secret) {
		// A 64-character hex string is a raw PSK rather than a passphrase, and
		// wpa_supplicant accepts it directly.
		return nil
	}
	if len(secret) < minPSKPassphrase || len(secret) > maxPSKPassphrase {
		return invalid("A WPA passphrase is %d to %d characters, or a %d-character hexadecimal key.",
			minPSKPassphrase, maxPSKPassphrase, pskHexKeyLength)
	}
	return nil
}

// secretPayload is the sealed plaintext. It is JSON rather than a bare string so
// a later EAP method that needs a second secret field is a payload addition
// rather than a re-encryption of every stored credential.
type secretPayload struct {
	// PSK is set for wpa_psk.
	PSK string `json:"psk,omitempty"`
	// Password is set for the Enterprise methods.
	Password string `json:"password,omitempty"`
}

func encodeSecret(security Security, secret string) ([]byte, error) {
	payload := secretPayload{}
	if security.Enterprise() {
		payload.Password = secret
	} else {
		payload.PSK = secret
	}
	return json.Marshal(payload)
}

func decodeSecret(security Security, plaintext []byte) (string, error) {
	var payload secretPayload
	if err := json.Unmarshal(plaintext, &payload); err != nil {
		// The bytes opened but are not a payload this server understands. Treat
		// it exactly like a failed decryption: fail closed, ask for re-entry.
		return "", ErrSecretUnreadable
	}
	secret := payload.PSK
	if security.Enterprise() {
		secret = payload.Password
	}
	if secret == "" {
		return "", ErrSecretUnreadable
	}
	return secret, nil
}

// ProfileName is the NetworkManager connection name Tilecast owns on a player.
// The namespace is what makes cleanup safe: the helper will only ever touch a
// connection whose name matches this shape, so an operator's own Wi-Fi profile
// can never be modified or deleted by Tilecast.
func ProfileName(networkID uuid.UUID) string {
	return "tilecast-presentation-" + networkID.String()
}
