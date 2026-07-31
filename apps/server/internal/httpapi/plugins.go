package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/plugins"
)

func (s *server) listPlugins(w http.ResponseWriter, r *http.Request) {
	catalog, err := s.plugins.Catalog(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": catalog})
}

func (s *server) dependencyGraph(w http.ResponseWriter, r *http.Request) {
	session := r.Context().Value(sessionContextKey).(auth.Session)
	screens, err := s.devices.ListScreensForUser(r.Context(), session.User.ID, session.User.Role)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	screenIDs := make([]uuid.UUID, 0, len(screens))
	for _, screen := range screens {
		screenIDs = append(screenIDs, screen.ID)
	}
	graph, err := s.plugins.DependencyGraph(r.Context(), screenIDs)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": graph})
}

func (s *server) listCountdownBars(w http.ResponseWriter, r *http.Request) {
	items, err := s.plugins.ListCountdownBars(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": items, "total": len(items)}})
}

func (s *server) getCountdownBar(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	item, err := s.plugins.GetCountdownBar(r.Context(), id)
	if err != nil {
		s.writePluginError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (s *server) createCountdownBar(w http.ResponseWriter, r *http.Request) {
	var input plugins.CountdownBarInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	item, err := s.plugins.CreateCountdownBar(r.Context(), user.ID, input)
	if err != nil {
		s.writePluginError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": item})
}

func (s *server) updateCountdownBar(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var input plugins.CountdownBarInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	item, err := s.plugins.UpdateCountdownBar(r.Context(), id, user.ID, input)
	if err != nil {
		s.writePluginError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": item})
}

func (s *server) deleteCountdownBar(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.plugins.DeleteCountdownBar(r.Context(), id, user.ID); err != nil {
		s.writePluginError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) writePluginError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, plugins.ErrNotFound):
		writeError(w, http.StatusNotFound, "plugin_instance_not_found", "The plugin instance was not found.")
	case errors.Is(err, plugins.ErrInvalid):
		writeError(w, http.StatusBadRequest, "invalid_plugin_configuration", err.Error())
	default:
		s.internalError(w, r, err)
	}
}
