package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
)

const deviceContextKey contextKey = "device"

func (s *server) systemIdentity(w http.ResponseWriter, r *http.Request) {
	identity, err := s.devices.Identity(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": identity})
}

type createPairingRequest struct {
	InstallationID string                 `json:"installationId"`
	Metadata       devices.DeviceMetadata `json:"metadata"`
}

func (s *server) createPairingSession(w http.ResponseWriter, r *http.Request) {
	var body createPairingRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	body.Metadata.ApproximateAddress = remoteIP(r.RemoteAddr)
	result, err := s.devices.CreatePairing(r.Context(), body.InstallationID, body.Metadata)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}

func (s *server) pollPairingSession(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusNotFound, "pairing_not_found", "Pairing session was not found.")
		return
	}
	secret, ok := parseAuthorization(r.Header.Get("Authorization"), "Pairing")
	if !ok {
		writeError(w, http.StatusUnauthorized, "pairing_secret_required", "The private pairing secret is required.")
		return
	}
	result, err := s.devices.PollPairing(r.Context(), id, secret)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

type enrollmentRequest struct {
	PairingSessionID uuid.UUID `json:"pairingSessionId"`
	EnrollmentToken  string    `json:"enrollmentToken"`
}

func (s *server) enrollPlayer(w http.ResponseWriter, r *http.Request) {
	var body enrollmentRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	result, err := s.devices.Enroll(r.Context(), body.PairingSessionID, body.EnrollmentToken)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"data": result})
}

func (s *server) requireDevice(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		credential, ok := parseAuthorization(r.Header.Get("Authorization"), "Bearer")
		if !ok {
			writeError(w, http.StatusUnauthorized, "device_credential_required", "A device credential is required.")
			return
		}
		principal, err := s.devices.AuthenticateDevice(r.Context(), credential)
		if err != nil {
			s.writeDeviceError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(withContext(r.Context(), deviceContextKey, principal)))
	})
}

func (s *server) playerHeartbeat(w http.ResponseWriter, r *http.Request) {
	var body devices.Heartbeat
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	principal := r.Context().Value(deviceContextKey).(devices.DevicePrincipal)
	if err := s.devices.Heartbeat(r.Context(), principal, body, r.RemoteAddr); err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	if s.playlists != nil {
		_ = s.playlists.ReportStatus(r.Context(), principal.ScreenID, playlists.PlayerStatus{
			ActiveManifestVersion: body.ActiveManifestVersion, PendingManifestVersion: body.PendingManifestVersion,
			AssignedPlaylistID: body.AssignedPlaylistID, CurrentItemID: body.CurrentItemID, CurrentAssetID: body.CurrentAssetID,
			PlaybackState: body.PlaybackState, DownloadQueueCount: body.DownloadQueueCount, DownloadedBytes: body.DownloadedBytes,
			RequiredBytes: body.RequiredBytes, CacheUsedBytes: body.CacheUsedBytes, CacheLimitBytes: body.CacheLimitBytes,
			LastSyncError: body.LastSynchronizationError, LastPlaybackError: body.LastPlaybackError,
			CurrentScheduleID: body.CurrentScheduleID, CurrentPlaylistID: body.CurrentPlaylistID, SelectionSource: body.SelectionSource, NextTransitionAt: body.NextTransitionAt, DeviceClockOffsetSeconds: body.DeviceClockOffsetSeconds, ScheduleEvaluationError: body.ScheduleEvaluationError, ScheduleManifestVersion: body.ScheduleManifestVersion,
			CurrentWebsiteAssetID: body.CurrentWebsiteAssetID, WebsiteState: body.WebsiteState, WebsiteLoadStartedAt: body.WebsiteLoadStartedAt, WebsiteLoadCompletedAt: body.WebsiteLoadCompletedAt, WebsiteFailureCategory: body.WebsiteFailureCategory, WebsiteBlockedNavigationCount: body.WebsiteBlockedNavigationCount, WebsiteCurrentHost: body.WebsiteCurrentHost, WebsiteFallbackShown: body.WebsiteFallbackShown, WebsiteRendererRecoveryCount: body.WebsiteRendererRecoveryCount,
			ActiveConfigRevision: body.ActiveConfigRevision, ConfigurationError: body.ConfigurationError,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"accepted": true}})
}

type pairingCodeRequest struct {
	Code string `json:"code"`
}

func (s *server) resolvePairing(w http.ResponseWriter, r *http.Request) {
	var body pairingCodeRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	request, err := s.devices.ResolvePairing(r.Context(), body.Code)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": request})
}

func (s *server) listPendingPairings(w http.ResponseWriter, r *http.Request) {
	requests, err := s.devices.ListPendingPairings(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": requests, "total": len(requests)}})
}

type approvePairingRequest struct {
	Name        string `json:"name"`
	Location    string `json:"location"`
	Description string `json:"description"`
}

func (s *server) approvePairing(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body approvePairingRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	screen, err := s.devices.ApprovePairing(r.Context(), id, user.ID, body.Name, body.Location, body.Description)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": screen})
}

func (s *server) rejectPairing(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.devices.RejectPairing(r.Context(), id, user.ID, body.Reason); err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) listScreens(w http.ResponseWriter, r *http.Request) {
	screens, err := s.devices.ListScreens(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"items": screens, "total": len(screens)}})
}

func (s *server) getScreen(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	screen, err := s.devices.GetScreen(r.Context(), id)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": screen})
}

func (s *server) updateScreen(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body approvePairingRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	screen, err := s.devices.UpdateScreen(r.Context(), id, user.ID, body.Name, body.Location, body.Description)
	if err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": screen})
}

func (s *server) disableScreen(w http.ResponseWriter, r *http.Request) {
	s.setScreenEnabled(w, r, false)
}
func (s *server) enableScreen(w http.ResponseWriter, r *http.Request) { s.setScreenEnabled(w, r, true) }

func (s *server) setScreenEnabled(w http.ResponseWriter, r *http.Request, enabled bool) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.devices.SetEnabled(r.Context(), id, user.ID, enabled); err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) revokeScreen(w http.ResponseWriter, r *http.Request) {
	id, ok := urlUUID(w, r, "id")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	user := r.Context().Value(sessionContextKey).(auth.Session).User
	if err := s.devices.Revoke(r.Context(), id, user.ID, body.Reason); err != nil {
		s.writeDeviceError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseAuthorization(value, scheme string) (string, bool) {
	prefix := scheme + " "
	if !strings.HasPrefix(value, prefix) || strings.TrimSpace(strings.TrimPrefix(value, prefix)) == "" {
		return "", false
	}
	return strings.TrimSpace(strings.TrimPrefix(value, prefix)), true
}

func urlUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, name))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "The requested resource was not found.")
		return uuid.Nil, false
	}
	return id, true
}

func (s *server) writeDeviceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, devices.ErrWrongInstallation):
		writeError(w, http.StatusConflict, "installation_identity_mismatch", "The Tilecast server identity does not match.")
	case errors.Is(err, devices.ErrNotFound), errors.Is(err, devices.ErrInvalidCode):
		writeError(w, http.StatusNotFound, "not_found", "The requested pairing or screen was not found.")
	case errors.Is(err, devices.ErrExpired):
		writeError(w, http.StatusGone, "pairing_expired", "The pairing session has expired.")
	case errors.Is(err, devices.ErrWrongSecret), errors.Is(err, devices.ErrInvalidCredential):
		writeError(w, http.StatusUnauthorized, "device_credential_invalid", "The player credential is invalid.")
	case errors.Is(err, devices.ErrRevokedCredential):
		writeError(w, http.StatusUnauthorized, "device_credential_revoked", "This player credential was revoked.")
	case errors.Is(err, devices.ErrDisabledScreen):
		writeError(w, http.StatusForbidden, "screen_disabled", "This screen is disabled.")
	case errors.Is(err, devices.ErrAlreadyClaimed):
		writeError(w, http.StatusConflict, "enrollment_already_used", "This enrollment result was already used.")
	case errors.Is(err, devices.ErrConflict):
		writeError(w, http.StatusConflict, "state_conflict", "The request conflicts with the current device state.")
	case errors.Is(err, devices.ErrForbidden):
		writeError(w, http.StatusForbidden, "pairing_disabled", "Device pairing is not available.")
	case strings.Contains(err.Error(), "must be") || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "too long"):
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", err.Error())
	default:
		s.internalError(w, r, err)
	}
}

func remoteIP(remoteAddr string) string {
	if index := strings.LastIndex(remoteAddr, ":"); index > 0 {
		return strings.Trim(remoteAddr[:index], "[]")
	}
	return remoteAddr
}

func withContext[T any](ctx context.Context, key contextKey, value T) context.Context {
	return context.WithValue(ctx, key, value)
}
