package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/media"
)

type createUploadRequest struct {
	Filename  string `json:"filename"`
	MIMEType  string `json:"mimeType"`
	SizeBytes int64  `json:"sizeBytes"`
}

func (s *server) createUpload(w http.ResponseWriter, r *http.Request) {
	var body createUploadRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if s.settings != nil {
		document, _ := s.settings.Organization(r.Context())
		if limit, ok := document.Values["media.upload.max_bytes"].(float64); ok && body.SizeBytes > int64(limit) {
			writeError(w, 422, "setting_exceeds_hard_limit", "Upload exceeds the Studio runtime limit.")
			return
		}
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	upload, err := s.media.CreateUpload(r.Context(), user.ID, body.Filename, body.MIMEType, body.SizeBytes)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": upload})
}

func (s *server) headUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	upload, err := s.media.GetUpload(r.Context(), id, user.ID)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	setUploadHeaders(w, upload)
	w.WriteHeader(http.StatusNoContent)
}
func setUploadHeaders(w http.ResponseWriter, u media.Upload) {
	w.Header().Set("Upload-Offset", strconv.FormatInt(u.CurrentOffset, 10))
	w.Header().Set("Upload-Length", strconv.FormatInt(u.ExpectedSize, 10))
	w.Header().Set("Upload-Status", string(u.Status))
	w.Header().Set("Upload-Expires", u.ExpiresAt.Format(time.RFC3339))
}

func (s *server) patchUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	offset, err := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	if err != nil || offset < 0 {
		writeError(w, http.StatusBadRequest, "invalid_upload_offset", "Upload-Offset must be a non-negative integer.")
		return
	}
	if contentType := r.Header.Get("Content-Type"); contentType != "" && !strings.HasPrefix(contentType, "application/offset+octet-stream") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_content_type", "Upload chunks must use application/offset+octet-stream.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	upload, err := s.media.AppendUpload(r.Context(), id, user.ID, offset, r.Body)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	setUploadHeaders(w, upload)
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) completeUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.FinalizeUpload(r.Context(), id, user.ID)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}
func (s *server) cancelUpload(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.media.CancelUpload(r.Context(), id, user.ID); err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listAssets(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	page, _ := strconv.Atoi(query.Get("page"))
	pageSize, _ := strconv.Atoi(query.Get("pageSize"))
	result, err := s.media.ListAssets(r.Context(), media.ListOptions{Search: query.Get("search"), Type: query.Get("type"), SourceProvider: query.Get("provider"), Status: query.Get("status"), Sort: query.Get("sort"), Page: page, PageSize: pageSize})
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}
func (s *server) getAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	asset, err := s.media.GetAsset(r.Context(), id)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}
func (s *server) createWebsite(w http.ResponseWriter, r *http.Request) {
	var body media.WebsiteInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(body.URL)), "http://") && s.settings != nil {
		document, _ := s.settings.Organization(r.Context())
		if enabled, _ := document.Values["website.private_http_enabled"].(bool); !enabled {
			writeError(w, 422, "setting_exceeds_hard_limit", "Private HTTP websites are disabled by runtime settings.")
			return
		}
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.CreateWebsite(r.Context(), user.ID, body)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": asset})
}
func (s *server) updateWebsite(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body media.WebsiteInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(body.URL)), "http://") && s.settings != nil {
		document, _ := s.settings.Organization(r.Context())
		if enabled, _ := document.Values["website.private_http_enabled"].(bool); !enabled {
			writeError(w, 422, "setting_exceeds_hard_limit", "Private HTTP websites are disabled by runtime settings.")
			return
		}
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.UpdateWebsite(r.Context(), id, user.ID, body)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}
func (s *server) websiteDiagnostics(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	result, err := s.media.WebsiteDiagnostics(r.Context(), id)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

func (s *server) createSource(w http.ResponseWriter, r *http.Request) {
	var body media.SourceInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if body.Provider == "website" && !s.sourcePrivateHTTPAllowed(r, body.Configuration) {
		writeError(w, 422, "setting_exceeds_hard_limit", "Private HTTP websites are disabled by runtime settings.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.CreateSource(r.Context(), user.ID, body)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": asset})
}

func (s *server) updateSource(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body media.SourceInput
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if body.Provider == "" {
		if existing, err := s.media.GetAsset(r.Context(), id); err == nil && existing.Source != nil {
			body.Provider = existing.Source.Provider
		}
	}
	if body.Provider == "website" && !s.sourcePrivateHTTPAllowed(r, body.Configuration) {
		writeError(w, 422, "setting_exceeds_hard_limit", "Private HTTP websites are disabled by runtime settings.")
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.UpdateSource(r.Context(), id, user.ID, body)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}

func (s *server) sourcePrivateHTTPAllowed(r *http.Request, configuration json.RawMessage) bool {
	var value struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(configuration, &value) != nil || !strings.HasPrefix(strings.ToLower(strings.TrimSpace(value.URL)), "http://") || s.settings == nil {
		return true
	}
	document, _ := s.settings.Organization(r.Context())
	enabled, _ := document.Values["website.private_http_enabled"].(bool)
	return enabled
}

func (s *server) duplicateSource(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.DuplicateSource(r.Context(), id, user.ID)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": asset})
}

type updateAssetRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
}

func (s *server) updateAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body updateAssetRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	asset, err := s.media.UpdateAsset(r.Context(), id, user.ID, body.Name, body.Description)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}
func (s *server) retryAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.media.RetryAsset(r.Context(), id, user.ID); err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	asset, err := s.media.GetAsset(r.Context(), id)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": asset})
}
func (s *server) deleteAsset(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.media.DeleteAsset(r.Context(), id, user.ID); err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) assetThumbnail(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	delivery, err := s.media.Preview(r.Context(), id)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	serveDelivery(w, r, delivery)
}
func (s *server) playerAssetVariant(w http.ResponseWriter, r *http.Request) {
	assetID, err := uuid.Parse(chi.URLParam(r, "assetId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	variantID, err := uuid.Parse(chi.URLParam(r, "variantId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	delivery, err := s.media.Delivery(r.Context(), assetID, variantID)
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	serveDelivery(w, r, delivery)
}
func serveDelivery(w http.ResponseWriter, r *http.Request, d media.Delivery) {
	file, err := os.Open(d.Path)
	if err != nil {
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", d.MIMEType)
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", media.ETag(d.HashHex))
	http.ServeContent(w, r, "", time.Time{}, file)
}

func (s *server) mediaDiagnostics(w http.ResponseWriter, r *http.Request) {
	diagnostics, err := s.media.Diagnostics()
	if err != nil {
		s.writeMediaError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": diagnostics})
}

func (s *server) writeMediaError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, media.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "The requested media resource was not found.")
	case errors.Is(err, media.ErrUploadTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "upload_too_large", "The upload exceeds this installation's size limit.")
	case errors.Is(err, media.ErrOffsetMismatch):
		writeError(w, http.StatusConflict, "upload_offset_mismatch", "The upload offset does not match the accepted offset.")
	case errors.Is(err, media.ErrUploadIncomplete):
		writeError(w, http.StatusConflict, "upload_incomplete", "The upload has not received all expected bytes.")
	case errors.Is(err, media.ErrUploadExpired):
		writeError(w, http.StatusGone, "upload_expired", "The upload session has expired.")
	case errors.Is(err, media.ErrUploadUnavailable):
		writeError(w, http.StatusConflict, "upload_state_conflict", "The upload cannot be changed in its current state.")
	case errors.Is(err, media.ErrInsufficientSpace):
		writeError(w, http.StatusInsufficientStorage, "insufficient_storage", "There is not enough reserved media storage for this upload.")
	case errors.Is(err, media.ErrUnsupportedType):
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "The uploaded file is not a supported image or video.")
	case errors.Is(err, media.ErrInspectionFailed):
		writeError(w, http.StatusUnprocessableEntity, "media_inspection_failed", "Tilecast could not inspect this media file.")
	case errors.Is(err, media.ErrVariantUnavailable):
		writeError(w, http.StatusNotFound, "media_variant_unavailable", "The requested media variant is unavailable.")
	case errors.Is(err, media.ErrNotReady):
		writeError(w, http.StatusConflict, "media_not_ready", "This media asset is not ready.")
	case strings.Contains(err.Error(), "in use by a playlist"):
		writeError(w, http.StatusConflict, "asset_in_use", "This asset is used by a playlist or website fallback and cannot be deleted.")
	case strings.Contains(err.Error(), "must be") || strings.Contains(err.Error(), "only failed") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "outside the configured") || strings.Contains(err.Error(), "exceeds the configured") || strings.Contains(err.Error(), "requires a fallback") || strings.Contains(err.Error(), "source limit") || strings.Contains(err.Error(), "source provider") || strings.Contains(err.Error(), "YouTube") || strings.Contains(err.Error(), "youtube.com") || strings.Contains(err.Error(), "volume") || strings.Contains(err.Error(), "start time") || strings.Contains(err.Error(), "end time") || strings.Contains(err.Error(), "caption language") || strings.Contains(err.Error(), "failure behavior") || strings.Contains(err.Error(), "fixed duration"):
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", err.Error())
	default:
		s.internalError(w, r, err)
	}
}
