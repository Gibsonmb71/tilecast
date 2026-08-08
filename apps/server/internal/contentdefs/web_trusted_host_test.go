package contentdefs

import (
	"strings"
	"testing"
)

func openHostDefinition() WidgetDefinition {
	return WidgetDefinition{
		ID: "self-hosted-dashboard",
		WebIntegration: &WebIntegration{
			URLField:          "dashboardUrl",
			AllowAnyHTTPSHost: true,
			Transform:         "passthrough",
		},
	}
}

func TestOpenHTTPSIntegrationRequiresExplicitTrustedHost(t *testing.T) {
	definition := openHostDefinition()
	_, _, err := WebPresentationURL(definition, map[string]any{
		"dashboardUrl": "https://grafana.example.com/d/abc",
	})
	if err == nil || !strings.Contains(err.Error(), "explicitly trusted") {
		t.Fatalf("expected explicit trust error, got %v", err)
	}
}

func TestOpenHTTPSIntegrationRestrictsPlayerToTrustedHost(t *testing.T) {
	definition := openHostDefinition()
	url, hosts, err := WebPresentationURL(definition, map[string]any{
		"dashboardUrl": "https://grafana.example.com/d/abc",
		"trustedHost":  "grafana.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	if url != "https://grafana.example.com/d/abc" {
		t.Fatalf("unexpected URL %q", url)
	}
	if len(hosts) != 1 || hosts[0] != "grafana.example.com" {
		t.Fatalf("unexpected allowed hosts %#v", hosts)
	}

	_, _, err = WebPresentationURL(definition, map[string]any{
		"dashboardUrl": "https://other.example.com/d/abc",
		"trustedHost":  "grafana.example.com",
	})
	if err == nil || !strings.Contains(err.Error(), "explicitly trusted host") {
		t.Fatalf("expected host mismatch error, got %v", err)
	}
}

func TestOpenHTTPSIntegrationAllowsExplicitPrivateHostTrust(t *testing.T) {
	definition := openHostDefinition()
	_, hosts, err := WebPresentationURL(definition, map[string]any{
		"dashboardUrl": "https://192.168.10.25/d/abc",
		"trustedHost":  "192.168.10.25",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 1 || hosts[0] != "192.168.10.25" {
		t.Fatalf("unexpected allowed hosts %#v", hosts)
	}
}

func TestTrustedHostRejectsURLSyntax(t *testing.T) {
	definition := openHostDefinition()
	_, _, err := WebPresentationURL(definition, map[string]any{
		"dashboardUrl": "https://grafana.example.com/d/abc",
		"trustedHost":  "https://grafana.example.com/admin",
	})
	if err == nil || !strings.Contains(err.Error(), "without a scheme") {
		t.Fatalf("expected trusted host syntax error, got %v", err)
	}
}
