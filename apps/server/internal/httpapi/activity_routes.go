package httpapi

import (
	"net/http"
	"strings"
)

func (s *server) activityRoutes(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/auth/logout" {
			s.auditAuthentication(next, w, r)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/player/heartbeat" {
			s.requireDevice(http.HandlerFunc(s.playerHeartbeatWithActivity)).ServeHTTP(w, r)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/player/activity-events" {
			s.requireDevice(http.HandlerFunc(s.ingestPlayerActivity)).ServeHTTP(w, r)
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/api/v1/activity/") && r.URL.Path != "/api/v1/activity" {
			next.ServeHTTP(w, r)
			return
		}
		var handler http.Handler
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/overview":
			handler = http.HandlerFunc(s.activityOverview)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/proof-of-play":
			handler = http.HandlerFunc(s.listProofOfPlay)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/proof-of-play/summary":
			handler = http.HandlerFunc(s.proofOfPlaySummary)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/proof-of-play/export.csv":
			handler = s.requireRoles("owner", "administrator")(http.HandlerFunc(s.exportProofOfPlay))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/screen-events":
			handler = s.requireRoles("owner", "administrator")(http.HandlerFunc(s.listScreenEvents))
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/audit":
			handler = http.HandlerFunc(s.listAuditActivity)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/audit/export.csv":
			handler = s.requireRoles("owner", "administrator")(http.HandlerFunc(s.exportAuditActivity))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/activity/screens/"):
			handler = http.HandlerFunc(s.screenActivity)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/activity/retention":
			handler = s.requireRoles("owner", "administrator")(http.HandlerFunc(s.getActivityRetention))
		case r.Method == http.MethodPatch && r.URL.Path == "/api/v1/activity/retention":
			handler = s.requireRoles("owner", "administrator")(s.requireCSRF(http.HandlerFunc(s.updateActivityRetention)))
		default:
			writeError(w, http.StatusNotFound, "activity_route_not_found", "Activity endpoint was not found.")
			return
		}
		s.requireSession(handler).ServeHTTP(w, r)
	})
}
