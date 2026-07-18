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
	if !limiter.allow("client", now.Add(2*time.Minute)) {
		t.Fatal("expected second request after reset to pass")
	}
	if limiter.allow("client", now.Add(2*time.Minute)) {
		t.Fatal("expected limit to apply to the new window")
	}

	boundary := newRateLimiter(1, time.Minute)
	if !boundary.allow("exact", now) || !boundary.allow("exact", now.Add(time.Minute)) {
		t.Fatal("expected an exact expiry boundary to start a new window")
	}

	cleanup := newRateLimiter(1, time.Minute)
	cleanup.allow("expired", now)
	cleanup.allow("expired-too", now)
	cleanup.allow("fresh", now.Add(time.Minute))
	if len(cleanup.entries) != 1 {
		t.Fatalf("expected expired entries to be evicted, got %d", len(cleanup.entries))
	}
}
