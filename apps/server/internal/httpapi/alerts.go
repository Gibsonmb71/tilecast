package httpapi

import (
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tilecast/tilecast/apps/server/internal/alerts"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
)

func (s *server) alertSettings(w http.ResponseWriter, r *http.Request) {
	if s.alerts == nil {
		writeError(w, http.StatusServiceUnavailable, "alert_monitor_unavailable", "NWS alert monitoring is unavailable.")
		return
	}
	monitor, err := s.alerts.Monitor(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	rules, err := s.alerts.Rules(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	active, err := s.alerts.Activations(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"monitor": monitor, "rules": rules, "activeAlerts": active}})
}

func (s *server) updateAlertMonitor(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Enabled             bool     `json:"enabled"`
		Areas               []string `json:"areas"`
		Zones               []string `json:"zones"`
		PollIntervalSeconds int      `json:"pollIntervalSeconds"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	monitor, err := s.alerts.UpdateMonitor(r.Context(), input.Enabled, input.Areas, input.Zones, input.PollIntervalSeconds, user.ID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "alert_monitor_invalid", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": monitor})
}

func (s *server) pollAlerts(w http.ResponseWriter, r *http.Request) {
	if err := s.alerts.Poll(r.Context()); err != nil {
		writeError(w, http.StatusBadGateway, "nws_poll_failed", "Tilecast could not retrieve active NWS alerts.")
		return
	}
	s.alertSettings(w, r)
}

func (s *server) createAlertRule(w http.ResponseWriter, r *http.Request) {
	s.saveAlertRule(w, r, uuid.Nil)
}

func (s *server) updateAlertRule(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	s.saveAlertRule(w, r, id)
}

func (s *server) saveAlertRule(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	var input alerts.RuleInput
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	rule, err := s.alerts.SaveRule(r.Context(), id, input, user.ID)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "alert_rule_invalid", err.Error())
		return
	}
	status := http.StatusOK
	if id == uuid.Nil {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]any{"data": rule})
}

func (s *server) deleteAlertRule(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.alerts.DeleteRule(r.Context(), id, user.ID); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "alert_rule_not_found", "NWS alert rule was not found.")
		return
	} else if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": id, "deleted": true}})
}
