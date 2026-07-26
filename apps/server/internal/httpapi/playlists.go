package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

type playlistDetailsRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type playlistCreateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	SourceType  string `json:"sourceType"`
}

func (s *server) listPlaylists(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	result, err := s.playlists.List(r.Context(), r.URL.Query().Get("search"), page, pageSize)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) createPlaylist(w http.ResponseWriter, r *http.Request) {
	var body playlistCreateRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.Create(r.Context(), user.ID, body.Name, body.Description, body.SourceType)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}
func (s *server) getPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	result, err := s.playlists.Get(r.Context(), id)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) updatePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body playlistDetailsRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.Update(r.Context(), id, user.ID, body.Name, body.Description)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.playlists.Delete(r.Context(), id, user.ID); err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *server) duplicatePlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.Duplicate(r.Context(), id, user.ID)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}

func (s *server) addPlaylistItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body playlists.ItemInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.AddItem(r.Context(), id, user.ID, body)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}
func (s *server) updatePlaylistItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	itemID, err := uuid.Parse(chi.URLParam(r, "itemId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist_item_not_found", "Playlist item was not found.")
		return
	}
	var body playlists.ItemInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.UpdateItem(r.Context(), id, itemID, user.ID, body)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) deletePlaylistItem(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	itemID, err := uuid.Parse(chi.URLParam(r, "itemId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist_item_not_found", "Playlist item was not found.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.DeleteItem(r.Context(), id, itemID, user.ID)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) reorderPlaylistItems(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		ItemIDs []uuid.UUID `json:"itemIds"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.Reorder(r.Context(), id, user.ID, body.ItemIDs)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func (s *server) setPlaylistTagRule(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body playlists.TagRuleInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.SetTagRule(r.Context(), id, user.ID, body)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func (s *server) getPlaylistAssignment(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	result, err := s.playlists.Assignment(r.Context(), id)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) assignPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		PlaylistID *uuid.UUID `json:"playlistId"`
		LayoutID   *uuid.UUID `json:"layoutId"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.AssignPresentation(r.Context(), id, body.PlaylistID, body.LayoutID, user.ID)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) unassignPlaylist(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	result, err := s.playlists.Unassign(r.Context(), id, user.ID)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func (s *server) playerManifest(w http.ResponseWriter, r *http.Request) {
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	manifest, etag, err := s.playlists.BuildManifest(r.Context(), principal.ScreenID)
	if err != nil {
		s.writePlaylistError(w, r, err)
		return
	}
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": manifest})
}

func (s *server) writePlaylistError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, playlists.ErrNotFound):
		writeError(w, http.StatusNotFound, "playlist_not_found", "The requested playlist was not found.")
	case errors.Is(err, playlists.ErrInvalidAsset):
		writeError(w, http.StatusUnprocessableEntity, "asset_not_ready", "Only ready assets with a playable variant may be added.")
	case errors.Is(err, playlists.ErrInvalidItem):
		writeError(w, http.StatusUnprocessableEntity, "playlist_validation_failed", "The playlist rule or item references unavailable content.")
	case errors.Is(err, playlists.ErrConflict):
		writeError(w, http.StatusConflict, "playlist_conflict", strings.TrimPrefix(err.Error(), playlists.ErrConflict.Error()+": "))
	case strings.Contains(err.Error(), "must be") || strings.Contains(err.Error(), "duration") || strings.Contains(err.Error(), "offset") || strings.Contains(err.Error(), "order") || strings.Contains(err.Error(), "in use") || strings.Contains(err.Error(), "cannot be added"):
		writeError(w, http.StatusUnprocessableEntity, "playlist_validation_failed", err.Error())
	default:
		s.internalError(w, r, err)
	}
}
