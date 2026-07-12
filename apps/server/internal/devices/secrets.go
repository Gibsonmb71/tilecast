package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"github.com/oklog/ulid/v2"
)

const pairingAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

var (
	ErrInvalidCode       = errors.New("pairing code is invalid")
	ErrNotFound          = errors.New("resource not found")
	ErrExpired           = errors.New("pairing session expired")
	ErrWrongInstallation = errors.New("installation identity does not match")
	ErrWrongSecret       = errors.New("secret is invalid")
	ErrAlreadyClaimed    = errors.New("pairing result has already been claimed")
	ErrRejected          = errors.New("pairing request was rejected")
	ErrConflict          = errors.New("resource conflicts with existing state")
	ErrInvalidCredential = errors.New("device credential is invalid")
	ErrRevokedCredential = errors.New("device credential is revoked")
	ErrDisabledScreen    = errors.New("screen is disabled")
	ErrForbidden         = errors.New("operation is not permitted")
)

func GeneratePairingCode() (string, error) {
	code := make([]byte, 6)
	limit := 256 - (256 % len(pairingAlphabet))
	for index := range code {
		for {
			var sample [1]byte
			if _, err := rand.Read(sample[:]); err != nil {
				return "", fmt.Errorf("generate pairing code: %w", err)
			}
			if int(sample[0]) < limit {
				code[index] = pairingAlphabet[int(sample[0])%len(pairingAlphabet)]
				break
			}
		}
	}
	return string(code), nil
}

func NormalizePairingCode(value string) (string, error) {
	value = strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), "-", ""), " ", ""))
	if len(value) != 6 {
		return "", ErrInvalidCode
	}
	for _, character := range value {
		if !strings.ContainsRune(pairingAlphabet, character) {
			return "", ErrInvalidCode
		}
	}
	return value, nil
}

func secretHash(secret string) []byte {
	hash := sha256.Sum256([]byte(secret))
	return hash[:]
}

func secretMatches(expected []byte, supplied string) bool {
	actual := secretHash(supplied)
	return len(expected) == len(actual) && subtle.ConstantTimeCompare(expected, actual) == 1
}

func randomSecret(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate random secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func newDeviceCredential() (publicID, secret, credential string, err error) {
	publicID = strings.ToLower(ulid.Make().String())
	secret, err = randomSecret(32)
	if err != nil {
		return "", "", "", err
	}
	return publicID, secret, "tc_device_" + publicID + "." + secret, nil
}

func ParseDeviceCredential(value string) (publicID, secret string, err error) {
	if !strings.HasPrefix(value, "tc_device_") {
		return "", "", ErrInvalidCredential
	}
	parts := strings.Split(strings.TrimPrefix(value, "tc_device_"), ".")
	if len(parts) != 2 || len(parts[0]) != 26 || len(parts[1]) < 40 {
		return "", "", ErrInvalidCredential
	}
	if _, err := ulid.ParseStrict(strings.ToUpper(parts[0])); err != nil {
		return "", "", ErrInvalidCredential
	}
	if _, err := base64.RawURLEncoding.DecodeString(parts[1]); err != nil {
		return "", "", ErrInvalidCredential
	}
	return parts[0], parts[1], nil
}
