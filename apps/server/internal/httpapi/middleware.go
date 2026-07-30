package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

const dashboardContentSecurityPolicy = "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com/beacon.min.js; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func (s *server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", dashboardContentSecurityPolicy)
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

func (s *server) requestLog(next http.Handler) http.Handler {
	next = s.activityRoutes(s.loginBackgroundRoutes(s.previewRoutes(next)))
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
	mu          sync.Mutex
	entries     map[string]rateEntry
	limit       int
	duration    time.Duration
	lastCleanup time.Time
}

func newRateLimiter(limit int, duration time.Duration) *rateLimiter {
	return &rateLimiter{entries: make(map[string]rateEntry), limit: limit, duration: duration}
}

func (r *rateLimiter) allow(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.lastCleanup.IsZero() || !now.Before(r.lastCleanup.Add(r.duration)) {
		for entryKey, entry := range r.entries {
			if !now.Before(entry.resetAt) {
				delete(r.entries, entryKey)
			}
		}
		r.lastCleanup = now
	}
	entry, ok := r.entries[key]
	if !ok || !now.Before(entry.resetAt) {
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
			retryAfter := int(limiter.duration / time.Second)
			if limiter.duration%time.Second != 0 {
				retryAfter++
			}
			w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many authentication attempts. Try again later.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireScreenScope refuses an operation on a screen outside the account's
// assigned scope.
//
// It is middleware rather than a check inside each handler so a screen route
// added later has to opt out of scoping deliberately rather than forget it. An
// unscoped account, and every Owner, passes through untouched.
func (s *server) requireScreenScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, ok := r.Context().Value(sessionContextKey).(auth.Session)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			// Let the handler report a malformed id in its own words.
			next.ServeHTTP(w, r)
			return
		}
		if err := s.devices.AuthorizeScreen(r.Context(), session.User.ID, session.User.Role, id); err != nil {
			if errors.Is(err, devices.ErrOutOfScope) {
				// 404 rather than 403: a scoped operator has no business
				// learning which screens exist outside their scope.
				writeError(w, http.StatusNotFound, "screen_not_found", "Screen was not found.")
				return
			}
			s.internalError(w, r, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// authorizeScreenList checks a set of screens and groups named in a request
// body. It returns false when it has already written the response.
func (s *server) authorizeScreenList(w http.ResponseWriter, r *http.Request, screens []uuid.UUID, groups []uuid.UUID) bool {
	session, ok := r.Context().Value(sessionContextKey).(auth.Session)
	if !ok {
		return true
	}
	targets := append([]uuid.UUID(nil), screens...)
	for _, group := range groups {
		rows, err := s.db.Query(r.Context(),
			`SELECT screen_id FROM screen_group_memberships WHERE screen_group_id=$1`, group)
		if err != nil {
			s.internalError(w, r, err)
			return false
		}
		for rows.Next() {
			var id uuid.UUID
			if rows.Scan(&id) == nil {
				targets = append(targets, id)
			}
		}
		rows.Close()
	}
	if err := s.devices.AuthorizeScreens(r.Context(), session.User.ID, session.User.Role, targets); err != nil {
		if errors.Is(err, devices.ErrOutOfScope) {
			writeError(w, http.StatusForbidden, "out_of_scope",
				"Some of the selected screens are outside your assigned scope.")
			return false
		}
		s.internalError(w, r, err)
		return false
	}
	return true
}
