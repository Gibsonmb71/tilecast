package httpapi

import "net/http"

func (s *server) listArchivedScreens(w http.ResponseWriter, r *http.Request) {
	screens, err := s.devices.ListArchivedScreens(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": screens, "total": len(screens)}})
}
