package httpapi

import "net/http"

// contentHealth reports content that is degrading quietly: a Data Source
// serving stale cache, a playlist with nothing available, media about to
// expire, and screens with nothing assigned.
//
// The first two are also incidents, so they reach notifications. The last two
// are not faults and never open one.
func (s *server) contentHealth(w http.ResponseWriter, r *http.Request) {
	report, err := s.contentHealthService.Report(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": report})
}
