package httpapi

import (
	"net/url"
	"testing"
)

func TestDefaultLoginBackgroundURL(t *testing.T) {
	t.Parallel()

	parsed, err := url.Parse(defaultLoginBackgroundURL)
	if err != nil {
		t.Fatalf("parse default login background URL: %v", err)
	}
	if parsed.Scheme != "https" {
		t.Fatalf("default login background must use HTTPS, got %q", parsed.Scheme)
	}
	if parsed.Host != "images.unsplash.com" {
		t.Fatalf("unexpected default login background host %q", parsed.Host)
	}
}
