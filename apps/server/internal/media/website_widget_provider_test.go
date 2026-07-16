package media

import (
	"context"
	"encoding/json"
	"testing"
)

func TestWebsiteWidgetProviderNormalizesConfigurationWithoutAssetName(t *testing.T) {
	service := &Service{cfg: Config{Website: WebsitePolicy{
		DefaultTimeoutSeconds: 20,
		MaxTimeoutSeconds:     120,
		MinRefreshSeconds:     30,
		MaxAllowedHosts:       25,
	}}}
	provider := websiteWidgetProvider{service: service}
	raw := json.RawMessage(`{
		"url":"https://example.com",
		"allowedHosts":[],
		"javascriptEnabled":true,
		"domStorageEnabled":true,
		"cookiePolicy":"first_party",
		"reloadPolicy":"on_each_activation",
		"loadTimeoutSeconds":20,
		"zoomPercent":100,
		"scrollX":0,
		"scrollY":0,
		"customUserAgent":"",
		"backgroundColor":"#13231E",
		"failureBehavior":"placeholder"
	}`)

	normalized, err := provider.Normalize(context.Background(), raw)
	if err != nil {
		t.Fatalf("normalize Website Widget configuration: %v", err)
	}
	config, ok := normalized.(WebsiteConfig)
	if !ok {
		t.Fatalf("unexpected normalized type %T", normalized)
	}
	if config.URL != "https://example.com" {
		t.Fatalf("unexpected normalized URL %q", config.URL)
	}
	if len(config.AllowedHosts) != 1 || config.AllowedHosts[0] != "example.com" {
		t.Fatalf("unexpected allowed hosts %#v", config.AllowedHosts)
	}
}
