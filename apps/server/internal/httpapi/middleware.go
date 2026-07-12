package httpapi

import (
	"log/slog"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
)

func (s *server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func (s *server) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)
		s.logger.Log(r.Context(), slog.LevelInfo, "HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}

type rateEntry struct {
	count   int
	resetAt time.Time
}

type rateLimiter struct {
	mu       sync.Mutex
	entries  map[string]rateEntry
	limit    int
	duration time.Duration
}

func newRateLimiter(limit int, duration time.Duration) *rateLimiter {
	return &rateLimiter{entries: make(map[string]rateEntry), limit: limit, duration: duration}
}

func (r *rateLimiter) allow(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.entries[key]
	if !ok || now.After(entry.resetAt) {
		r.entries[key] = rateEntry{count: 1, resetAt: now.Add(r.duration)}
		return true
	}
	if entry.count >= r.limit {
		return false
	}
	entry.count++
	r.entries[key] = entry
	return true
}

func (s *server) authRateLimit(next http.Handler) http.Handler {
	return s.rateLimit(s.authLimiter, false, next)
}

func (s *server) pairingRateLimit(next http.Handler) http.Handler {
	return s.rateLimit(s.pairingLimiter, false, next)
}

func (s *server) codeRateLimit(next http.Handler) http.Handler {
	return s.rateLimit(s.codeLimiter, true, next)
}

func (s *server) operationsRateLimit(next http.Handler) http.Handler {
	return s.rateLimit(s.operationsLimiter, true, next)
}

func (s *server) rateLimit(limiter *rateLimiter, includeUser bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.RemoteAddr
		if addrPort, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
			key = addrPort.Addr().String()
		}
		if includeUser {
			if session, ok := r.Context().Value(sessionContextKey).(auth.Session); ok {
				key += ":" + session.User.ID.String()
			}
		}
		if !limiter.allow(key, time.Now()) {
			w.Header().Set("Retry-After", "600")
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many authentication attempts. Try again later.")
			return
		}
		next.ServeHTTP(w, r)
	})
}
