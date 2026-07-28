package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// RFC 6238 with the parameters every mainstream authenticator app assumes:
// SHA-1, six digits, thirty-second steps. Authenticator apps do not negotiate,
// so these are fixed rather than configurable.
const (
	totpDigits     = 6
	totpPeriod     = 30 * time.Second
	totpSecretLen  = 20
	totpSkewSteps  = 1
	totpDigitSpace = 1000000
)

var totpEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() ([]byte, error) {
	secret := make([]byte, totpSecretLen)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("generate authenticator secret: %w", err)
	}
	return secret, nil
}

// TOTPSecretKey renders a secret in the base32 form an authenticator app
// expects when the code is typed in by hand instead of scanned.
func TOTPSecretKey(secret []byte) string {
	return totpEncoding.EncodeToString(secret)
}

// TOTPProvisioningURI builds the otpauth:// URI encoded into the setup QR code.
// The issuer is repeated in the label because several apps read only one of the
// two and would otherwise show an unlabelled account.
func TOTPProvisioningURI(secret []byte, issuer, account string) string {
	issuer = strings.TrimSpace(issuer)
	if issuer == "" {
		issuer = "Tilecast"
	}
	label := url.PathEscape(issuer + ":" + account)
	query := url.Values{}
	query.Set("secret", TOTPSecretKey(secret))
	query.Set("issuer", issuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", fmt.Sprint(totpDigits))
	query.Set("period", fmt.Sprint(int(totpPeriod.Seconds())))
	return "otpauth://totp/" + label + "?" + query.Encode()
}

func totpCode(secret []byte, step int64) string {
	var counter [8]byte
	binary.BigEndian.PutUint64(counter[:], uint64(step))
	mac := hmac.New(sha1.New, secret)
	mac.Write(counter[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, value%totpDigitSpace)
}

func normalizeTOTPCode(code string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, code)
}

// verifyTOTP checks a code against the current step and one step either side,
// which absorbs ordinary clock drift. It returns the step that matched so the
// caller can refuse anything that is not strictly newer; without that check a
// code stays valid for its whole window and can be replayed.
func verifyTOTP(secret []byte, code string, at time.Time, lastUsedStep *int64) (int64, bool) {
	code = normalizeTOTPCode(code)
	if len(code) != totpDigits {
		return 0, false
	}
	current := at.Unix() / int64(totpPeriod.Seconds())
	for offset := int64(-totpSkewSteps); offset <= totpSkewSteps; offset++ {
		step := current + offset
		if subtle.ConstantTimeCompare([]byte(totpCode(secret, step)), []byte(code)) != 1 {
			continue
		}
		if lastUsedStep != nil && step <= *lastUsedStep {
			return 0, false
		}
		return step, true
	}
	return 0, false
}
