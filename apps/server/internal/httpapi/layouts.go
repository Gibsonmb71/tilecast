package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/layouts"
)

type layoutDetailsRequest struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Orientation  string `json:"orientation"`
	CanvasWidth  int    `json:"canvasWidth"`
	CanvasHeight int    `json:"canvasHeight"`
}

func (s *server) listLayouts(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	result, err := s.layouts.List(r.Context(), r.URL.Query().Get("search"), page, pageSize)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) createLayout(w http.ResponseWriter, r *http.Request) {
	var body layoutDetailsRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.Create(r.Context(), user.ID, body.Name, body.Description, body.Orientation, body.CanvasWidth, body.CanvasHeight)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.Header().Set("ETag", layoutETag(result.DraftRevision))
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}
func (s *server) getLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	result, err := s.layouts.Get(r.Context(), id)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.Header().Set("ETag", layoutETag(result.DraftRevision))
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) updateLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.UpdateDetails(r.Context(), id, user.ID, body.Name, body.Description)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.Header().Set("ETag", layoutETag(result.DraftRevision))
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) saveLayoutDraft(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		ExpectedDraftRevision int64            `json:"expectedDraftRevision"`
		Document              layouts.Document `json:"document"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.SaveDraft(r.Context(), id, user.ID, body.ExpectedDraftRevision, body.Document)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.Header().Set("ETag", layoutETag(result.DraftRevision))
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) publishLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		ExpectedDraftRevision int64 `json:"expectedDraftRevision"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.Publish(r.Context(), id, user.ID, body.ExpectedDraftRevision)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}
func (s *server) duplicateLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.Duplicate(r.Context(), id, user.ID)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}
func (s *server) deleteLayout(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.layouts.Delete(r.Context(), id, user.ID); err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *server) listLayoutRevisions(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	result, err := s.layouts.Revisions(r.Context(), id, page, pageSize)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) restoreLayoutRevision(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	revisionID, ok := urlUUID(w, r, "revisionId")
	if !ok {
		return
	}
	var body struct {
		ExpectedDraftRevision int64 `json:"expectedDraftRevision"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.layouts.Restore(r.Context(), id, revisionID, user.ID, body.ExpectedDraftRevision)
	if err != nil {
		s.writeLayoutError(w, r, err)
		return
	}
	w.Header().Set("ETag", layoutETag(result.DraftRevision))
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func layoutETag(revision int64) string {
	return `"layout-draft-` + strconv.FormatInt(revision, 10) + `"`
}
func (s *server) writeLayoutError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, layouts.ErrNotFound):
		writeError(w, http.StatusNotFound, "layout_not_found", "The requested Layout was not found.")
	case errors.Is(err, layouts.ErrConflict):
		writeError(w, http.StatusConflict, "layout_revision_conflict", "The Layout draft changed. Reload it before saving again.")
	case errors.Is(err, layouts.ErrInUse):
		writeError(w, http.StatusConflict, "layout_in_use", "Remove the Layout from assignments and schedules before deleting it.")
	case strings.Contains(err.Error(), "layout") || strings.Contains(err.Error(), "placement") || strings.Contains(err.Error(), "primitive") || strings.Contains(err.Error(), "dependency"):
		writeError(w, http.StatusUnprocessableEntity, "layout_validation_failed", err.Error())
	default:
		s.internalError(w, r, err)
	}
}
