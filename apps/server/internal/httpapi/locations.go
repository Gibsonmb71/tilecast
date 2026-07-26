package httpapi

import (
	"net/http"

	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

func (s *server) listLocations(w http.ResponseWriter, r *http.Request) {
	items, err := s.devices.ListLocations(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items, "total": len(items)}})
}

func (s *server) createLocation(w http.ResponseWriter, r *http.Request) {
	var input devices.LocationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	item, err := s.devices.CreateLocation(r.Context(), user.ID, input)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (s *server) updateLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var input devices.LocationInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	item, err := s.devices.UpdateLocation(r.Context(), id, user.ID, input)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (s *server) deleteLocation(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.devices.DeleteLocation(r.Context(), id, user.ID); err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
