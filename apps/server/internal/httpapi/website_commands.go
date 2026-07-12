package httpapi

import (
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"net/http"
	"time"
)

func (s *server) clearWebsiteData(w http.ResponseWriter, r *http.Request) {
	screen, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	var exists bool
	if err := s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM screens WHERE id=$1)`, screen).Scan(&exists); err != nil {
		s.internalError(w, r, err)
		return
	}
	if !exists {
		writeError(w, 404, "screen_not_found", "Screen was not found.")
		return
	}
	_, _ = s.db.Exec(r.Context(), `UPDATE website_data_clear_commands SET status='expired' WHERE screen_id=$1 AND status='pending' AND expires_at<=now()`, screen)
	var existing uuid.UUID
	var existingExpiry time.Time
	if err := s.db.QueryRow(r.Context(), `SELECT id,expires_at FROM website_data_clear_commands WHERE screen_id=$1 AND status='pending' AND expires_at>now()`, screen).Scan(&existing, &existingExpiry); err == nil {
		s.devices.Notify(screen, map[string]any{"type": "website.clear_data", "commandId": existing, "expiresAt": existingExpiry})
		writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"commandId": existing, "status": "pending", "expiresAt": existingExpiry}})
		return
	}
	id := uuid.New()
	expires := time.Now().Add(10 * time.Minute)
	if _, err := s.db.Exec(r.Context(), `INSERT INTO website_data_clear_commands(id,screen_id,requested_by,expires_at)VALUES($1,$2,$3,$4)`, id, screen, user.ID, expires); err != nil {
		s.internalError(w, r, err)
		return
	}
	_, _ = s.db.Exec(r.Context(), `INSERT INTO audit_logs(id,user_id,action,resource_type,resource_id)VALUES($1,$2,'website.data_clear_requested','screen',$3)`, uuid.New(), user.ID, screen.String())
	s.devices.Notify(screen, map[string]any{"type": "website.clear_data", "commandId": id, "expiresAt": expires})
	writeJSON(w, http.StatusAccepted, map[string]any{"data": map[string]any{"commandId": id, "status": "pending", "expiresAt": expires}})
}
