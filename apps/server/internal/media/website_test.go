package media

import (
	"context"
	"testing"
)

func websiteService(allow bool) *Service {
	return &Service{cfg: Config{Website: WebsitePolicy{AllowPrivateHTTP: allow, DefaultTimeoutSeconds: 20, MaxTimeoutSeconds: 120, MinRefreshSeconds: 30, MaxAllowedHosts: 25, MaxWebsites: 500}}}
}
func validWebsite() WebsiteInput {
	return WebsiteInput{Name: "Public site", WebsiteConfig: WebsiteConfig{URL: "https://example.com/signage", JavaScriptEnabled: true, DOMStorageEnabled: true, CookiePolicy: "first_party", ReloadPolicy: "on_each_activation", LoadTimeoutSeconds: 20, ZoomPercent: 100, BackgroundColor: "#13231E", FailureBehavior: "placeholder"}}
}
func TestWebsiteURLAndHostPolicy(t *testing.T) {
	s := websiteService(false)
	in := validWebsite()
	got, err := s.normalizeWebsite(context.Background(), in)
	if err != nil || len(got.AllowedHosts) != 1 || got.AllowedHosts[0] != "example.com" {
		t.Fatalf("normalize=%#v %v", got, err)
	}
	bad := []string{"http://example.com", "file:///tmp/a", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com:8443"}
	for _, raw := range bad {
		in = validWebsite()
		in.URL = raw
		if _, err = s.normalizeWebsite(context.Background(), in); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	in = validWebsite()
	in.URL = "http://192.168.1.5/page"
	if _, err = websiteService(true).normalizeWebsite(context.Background(), in); err != nil {
		t.Fatal(err)
	}
	in.URL = "http://203.0.113.2/page"
	if _, err = websiteService(true).normalizeWebsite(context.Background(), in); err == nil {
		t.Fatal("accepted public HTTP")
	}
}
func TestWebsiteSettingsLimits(t *testing.T) {
	s := websiteService(false)
	in := validWebsite()
	in.CustomUserAgent = "bad\nagent"
	if _, err := s.normalizeWebsite(context.Background(), in); err == nil {
		t.Fatal("accepted control character")
	}
	in = validWebsite()
	in.ReloadPolicy = "interval"
	fast := 10
	in.RefreshIntervalSeconds = &fast
	if _, err := s.normalizeWebsite(context.Background(), in); err == nil {
		t.Fatal("accepted fast refresh")
	}
	in = validWebsite()
	in.ZoomPercent = 201
	if _, err := s.normalizeWebsite(context.Background(), in); err == nil {
		t.Fatal("accepted zoom")
	}
}
