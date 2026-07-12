package httpapi

import (
	"testing"
	"time"
)

func TestRateLimiter(t *testing.T) {
	limiter := newRateLimiter(2, time.Minute)
	now := time.Now()
	if !limiter.allow("client", now) || !limiter.allow("client", now) {
		t.Fatal("expected first two requests to pass")
	}
	if limiter.allow("client", now) {
		t.Fatal("expected third request to be limited")
	}
	if !limiter.allow("client", now.Add(2*time.Minute)) {
		t.Fatal("expected request after reset to pass")
	}
}
