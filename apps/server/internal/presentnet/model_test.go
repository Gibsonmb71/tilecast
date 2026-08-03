package presentnet

import (
	"strings"
	"testing"
)

func TestValidateInputUsesTriStateCredentialRule(t *testing.T) {
	base := Input{
		Name:     "  District   Staff Wi-Fi ",
		SSID:     "  District Staff  ",
		Security: SecurityPSK,
	}
	if _, err := ValidateInput(base, false); err == nil {
		t.Fatal("create without a credential was accepted")
	}
	secret := "correct-horse"
	base.Secret = &secret
	validated, err := ValidateInput(base, false)
	if err != nil {
		t.Fatal(err)
	}
	if validated.Name != "District Staff Wi-Fi" || validated.SSID != "District Staff" || validated.Secret == nil {
		t.Fatalf("validated=%+v, want normalized public fields and credential", validated)
	}
	base.Secret = nil
	if _, err := ValidateInput(base, true); err != nil {
		t.Fatalf("update without a new credential rejected: %v", err)
	}
}

func TestValidateEnterpriseFieldsAndCertificateBoundary(t *testing.T) {
	secret := "enterprise-password"
	input := Input{
		Name:     "District Enterprise",
		SSID:     "District-Enterprise",
		Security: SecurityEnterprisePEAP,
		Secret:   &secret,
		Auth: AuthMetadata{
			Identity:          "tilecast@district.example",
			AnonymousIdentity: "anonymous@district.example",
			CACertificatePEM:  "-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----",
			DomainSuffixMatch: "radius.district.example",
		},
	}
	validated, err := ValidateInput(input, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(validated.Auth.CACertificatePEM, "\n") {
		t.Fatal("validated CA certificate was not normalized")
	}

	bad := input
	bad.Auth.CACertificatePEM = "-----BEGIN PRIVATE KEY-----\nAQID\n-----END PRIVATE KEY-----"
	if _, err := ValidateInput(bad, false); err == nil {
		t.Fatal("private key was accepted as a CA certificate")
	}
	bad = input
	bad.Auth.DomainSuffixMatch = "radius.example"
	bad.Auth.CACertificatePEM = ""
	if _, err := ValidateInput(bad, false); err == nil {
		t.Fatal("domain suffix without a CA certificate was accepted")
	}
}

func TestValidateInputDoesNotEchoCredentialValues(t *testing.T) {
	secret := "bad\ncredential"
	_, err := ValidateInput(Input{
		Name:     "Network",
		SSID:     "SSID",
		Security: SecurityPSK,
		Secret:   &secret,
	}, false)
	if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "credential") && strings.Contains(err.Error(), "bad") {
		t.Fatalf("validation error may expose the credential: %v", err)
	}
}
