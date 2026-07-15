package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/media"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
	"github.com/tilecast/tilecast/apps/server/internal/updates"
	"github.com/tilecast/tilecast/apps/server/internal/web"
)

type Dependencies struct {
	Auth                *auth.Service
	Devices             *devices.Service
	Media               *media.Service
	Playlists           *playlists.Service
	Scheduling          *scheduling.Service
	Settings            *settings.Service
	Updates             *updates.Service
	DB                  *pgxpool.Pool
	Logger              *slog.Logger
	CookieName          string
	SecureCookies       bool
	ReleasePublishToken string
	Operations          OperationsConfig
}

type OperationsConfig struct {
	MaxEmergencyDurationHours   int
	MaxEmergencyTargets         int
	MaxPendingCommands          int
	DefaultCommandExpiryMinutes int
	MaxIdentifySeconds          int
	CommandRetentionDays        int
}

type server struct {
	auth                          *auth.Service
	devices                       *devices.Service
	media                         *media.Service
	playlists                     *playlists.Service
	scheduling                    *scheduling.Service
	db                            *pgxpool.Pool
	logger                        *slog.Logger
	cookieName                    string
	secureCookies                 bool
	authLimiter                   *rateLimiter
	pairingLimiter                *rateLimiter
	codeLimiter                   *rateLimiter
	operationsLimiter             *rateLimiter
	operations                    OperationsConfig
	settings                      *settings.Service
	updates                       *updates.Service
	releasePublishTokenHash       [32]byte
	releasePublishTokenConfigured bool
	startedAt                     time.Time
}

type contextKey string

const sessionContextKey contextKey = "session"

func New(deps Dependencies) http.Handler {
	s := &server{
		auth:              deps.Auth,
		devices:           deps.Devices,
		media:             deps.Media,
		playlists:         deps.Playlists,
		scheduling:        deps.Scheduling,
		db:                deps.DB,
		logger:            deps.Logger,
		cookieName:        deps.CookieName,
		secureCookies:     deps.SecureCookies,
		authLimiter:       newRateLimiter(10, 10*time.Minute),
		pairingLimiter:    newRateLimiter(10, time.Minute),
		codeLimiter:       newRateLimiter(30, 10*time.Minute),
		operationsLimiter: newRateLimiter(60, time.Minute),
		operations:        deps.Operations,
		settings:          deps.Settings,
		updates:           deps.Updates,
		startedAt:         time.Now(),
	}
	if deps.ReleasePublishToken != "" {
		s.releasePublishTokenHash = sha256.Sum256([]byte(deps.ReleasePublishToken))
		s.releasePublishTokenConfigured = true
	}
	if s.operations.MaxEmergencyDurationHours == 0 {
		s.operations = OperationsConfig{24, 250, 50, 10, 120, 30}
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(s.securityHeaders)
	r.Use(s.requestLog)
	r.Get("/healthz", s.health)
	r.Get("/readyz", s.ready)
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/system/health", s.health)
		api.Get("/system/identity", s.systemIdentity)
		api.Get("/auth/status", s.authStatus)
		api.With(s.authRateLimit).Post("/auth/setup", s.setup)
		api.With(s.authRateLimit).Post("/auth/login", s.login)
		api.With(s.requireSession, s.requireCSRF).Post("/auth/logout", s.logout)

		api.With(s.pairingRateLimit).Post("/player/pairing-sessions", s.createPairingSession)
		api.Get("/player/pairing-sessions/{id}", s.pollPairingSession)
		api.With(s.pairingRateLimit).Post("/player/enroll", s.enrollPlayer)
		api.With(s.requireDevice).Post("/player/heartbeat", s.playerHeartbeat)
		api.With(s.requireDevice).Get("/player/socket", s.playerSocket)
		api.With(s.requireDevice).Get("/player/assets/{assetId}/variants/{variantId}", s.playerAssetVariant)
		api.With(s.requireDevice).Head("/player/assets/{assetId}/variants/{variantId}", s.playerAssetVariant)
		api.With(s.requireDevice).Get("/player/manifest", s.playerManifest)
		api.With(s.requireDevice).Get("/player/commands", s.playerCommands)
		api.With(s.requireDevice).Get("/player/config", s.playerConfig)
		api.With(s.requireDevice).Post("/player/commands/{id}/acknowledge", s.acknowledgePlayerCommand)
		api.With(s.requireDevice).Post("/player/commands/{id}/result", s.resultPlayerCommand)
		api.With(s.requireDevice).Get("/player/updates/{releaseId}", s.playerUpdateMetadata)
		api.With(s.requireDevice).Get("/player/updates/{releaseId}/apk", s.playerUpdateAPK)
		api.With(s.requireDevice).Head("/player/updates/{releaseId}/apk", s.playerUpdateAPK)
		api.With(s.requireDevice).Post("/player/update-deployments/{deploymentId}/status", s.playerUpdateStatus)
		api.With(s.operationsRateLimit, s.requireReleasePublisher).Post("/player-releases/upload", s.uploadPlayerRelease)

		api.Group(func(dashboard chi.Router) {
			dashboard.Use(s.requireSession)
			dashboard.Get("/screens", s.listScreens)
			dashboard.Get("/screens/{id}", s.getScreen)
			dashboard.Get("/screens/{id}/reliability", s.screenReliability)
			dashboard.Get("/screen-groups", s.listScreenGroups)
			dashboard.Get("/screen-groups/{id}", s.getScreenGroup)
			dashboard.Get("/schedules", s.listSchedules)
			dashboard.Get("/schedules/{id}", s.getSchedule)
			dashboard.Get("/settings", s.getSettings)
			dashboard.With(s.requireRoles("owner", "administrator")).Get("/users", s.listUsers)
			dashboard.Get("/me/preferences", s.getPreferences)
			dashboard.With(s.requireCSRF).Patch("/me/preferences", s.updatePreferences)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Patch("/settings", s.updateSettings)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/settings/reset", s.resetSettings)
			dashboard.Get("/screen-groups/{id}/policy", s.getGroupPolicy)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Put("/screen-groups/{id}/policy", s.putGroupPolicy)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screen-groups/{id}/policy", s.deleteGroupPolicy)
			dashboard.Get("/screens/{id}/policy", s.getScreenPolicy)
			dashboard.Get("/screens/{id}/effective-policy", s.getEffectivePolicy)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Put("/screens/{id}/policy", s.putScreenPolicy)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screens/{id}/policy", s.deleteScreenPolicy)
			dashboard.With(s.requireRoles("owner", "administrator")).Get("/system/status", s.systemStatus)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/system/maintenance/{action}", s.systemMaintenance)
			dashboard.With(s.requireRoles("owner")).Get("/system/settings/export", s.exportSettings)
			dashboard.With(s.requireRoles("owner"), s.requireCSRF).Post("/system/settings/import/preview", s.previewSettingsImport)
			dashboard.With(s.requireRoles("owner"), s.requireCSRF).Post("/system/settings/import/apply", s.applySettingsImport)
			dashboard.Get("/emergencies", s.listEmergencies)
			dashboard.Get("/player-releases", s.listPlayerReleases)
			dashboard.With(s.requireRoles("owner"), s.operationsRateLimit, s.requireCSRF).Post("/player-releases/check", s.checkPlayerReleases)
			dashboard.With(s.requireRoles("owner"), s.operationsRateLimit, s.requireCSRF).Post("/player-releases/github/device", s.startGitHubDeviceAuthorization)
			dashboard.With(s.requireRoles("owner"), s.requireCSRF).Post("/player-releases/github/device/poll", s.pollGitHubDeviceAuthorization)
			dashboard.With(s.requireRoles("owner"), s.requireCSRF).Delete("/player-releases/github", s.disconnectGitHub)
			dashboard.With(s.requireRoles("owner"), s.operationsRateLimit, s.requireCSRF).Post("/player-releases/{id}/cache", s.cachePlayerRelease)
			dashboard.Get("/update-deployments", s.listUpdateDeployments)
			dashboard.Get("/update-deployments/{id}", s.getUpdateDeployment)
			dashboard.With(s.requireRoles("owner", "administrator"), s.operationsRateLimit, s.requireCSRF).Post("/update-deployments", s.createUpdateDeployment)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/update-deployments/{id}/cancel", s.cancelUpdateDeployment)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/update-deployments/{id}/screens/{screenId}/retry", s.retryUpdateScreen)
			dashboard.Get("/emergencies/{id}", s.getEmergency)
			dashboard.With(s.requireRoles("owner", "administrator"), s.operationsRateLimit, s.requireCSRF).Post("/emergencies", s.activateEmergency)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/emergencies/{id}/cancel", s.cancelEmergency)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screen-groups", s.createScreenGroup)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Patch("/screen-groups/{id}", s.updateScreenGroup)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screen-groups/{id}", s.deleteScreenGroup)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screen-groups/{id}/screens", s.addScreenGroupMember)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screen-groups/{id}/screens/{screenId}", s.removeScreenGroupMember)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Put("/screen-groups/{id}/playlist-assignment", s.assignSyncGroupPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screen-groups/{id}/playlist-assignment", s.unassignSyncGroupPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/schedules", s.createSchedule)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Patch("/schedules/{id}", s.updateSchedule)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/schedules/{id}", s.deleteSchedule)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/schedules/{id}/enable", s.enableSchedule)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/schedules/{id}/disable", s.disableSchedule)
			dashboard.With(s.requireRoles("owner", "administrator")).Post("/schedules/preview", s.previewSchedule)
			dashboard.Get("/assets", s.listAssets)
			dashboard.Get("/assets/{id}", s.getAsset)
			dashboard.Get("/assets/{id}/website/diagnostics", s.websiteDiagnostics)
			dashboard.Get("/assets/{id}/thumbnail", s.assetThumbnail)
			dashboard.Get("/playlists", s.listPlaylists)
			dashboard.Get("/playlists/{id}", s.getPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/playlists", s.createPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/playlists/{id}", s.updatePlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Delete("/playlists/{id}", s.deletePlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/playlists/{id}/duplicate", s.duplicatePlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/playlists/{id}/items", s.addPlaylistItem)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/playlists/{id}/items/{itemId}", s.updatePlaylistItem)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Delete("/playlists/{id}/items/{itemId}", s.deletePlaylistItem)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Put("/playlists/{id}/items/order", s.reorderPlaylistItems)
			dashboard.Get("/screens/{id}/playlist-assignment", s.getPlaylistAssignment)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Put("/screens/{id}/playlist-assignment", s.assignPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Delete("/screens/{id}/playlist-assignment", s.unassignPlaylist)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/assets/{id}", s.updateAsset)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/assets/websites", s.createWebsite)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/assets/{id}/website", s.updateWebsite)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/sources", s.createSource)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.operationsRateLimit, s.requireCSRF).Post("/sources/calendar/preview", s.previewCalendarSource)
			dashboard.Get("/sources/{id}/diagnostics", s.sourceDiagnostics)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/sources/{id}", s.updateSource)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/sources/{id}/duplicate", s.duplicateSource)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Delete("/assets/{id}", s.deleteAsset)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/assets/{id}/retry", s.retryAsset)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/uploads", s.createUpload)
			dashboard.Head("/uploads/{id}", s.headUpload)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Patch("/uploads/{id}", s.patchUpload)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Post("/uploads/{id}/complete", s.completeUpload)
			dashboard.With(s.requireRoles("owner", "administrator", "editor"), s.requireCSRF).Delete("/uploads/{id}", s.cancelUpload)
			dashboard.With(s.requireRoles("owner", "administrator")).Get("/system/media-diagnostics", s.mediaDiagnostics)
			dashboard.With(s.requireRoles("owner", "administrator")).Get("/screens/pairing/pending", s.listPendingPairings)
			dashboard.With(s.codeRateLimit).Post("/screens/pairing/resolve", s.resolvePairing)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/pairing/{id}/approve", s.approvePairing)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/pairing/{id}/reject", s.rejectPairing)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Patch("/screens/{id}", s.updateScreen)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/{id}/disable", s.disableScreen)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/{id}/enable", s.enableScreen)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/{id}/revoke", s.revokeScreen)
			dashboard.Get("/screens/{id}/commands", s.listScreenCommands)
			dashboard.With(s.requireRoles("owner", "administrator"), s.operationsRateLimit, s.requireCSRF).Post("/screens/{id}/commands", s.createPlayerCommand)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Post("/screens/{id}/commands/{commandId}/cancel", s.cancelPlayerCommand)
			dashboard.With(s.requireRoles("owner", "administrator"), s.requireCSRF).Put("/screens/{id}/power-assist", s.confirmPowerAssist)
		})
	})
	r.Handle("/*", web.Handler())
	return r
}

func (s *server) requireRoles(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, role := range roles {
		allowed[role] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, ok := r.Context().Value(sessionContextKey).(auth.Session)
			if !ok || !allowed[session.User.Role] {
				writeError(w, http.StatusForbidden, "insufficient_role", "Owner or Administrator access is required.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"status": "ok", "service": "tilecast-server"}})
}

func (s *server) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "The database is not ready.")
		return
	}
	if s.media != nil {
		diagnostics, err := s.media.Diagnostics()
		if err != nil || diagnostics["ffmpegAvailable"] != true || diagnostics["ffprobeAvailable"] != true {
			writeError(w, http.StatusServiceUnavailable, "media_infrastructure_unavailable", "Media storage or processing tools are not ready.")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"status": "ready"}})
}

func (s *server) authStatus(w http.ResponseWriter, r *http.Request) {
	required, err := s.auth.SetupRequired(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	result := map[string]any{"setupRequired": required, "authenticated": false}
	if !required {
		if cookie, err := r.Cookie(s.cookieName); err == nil {
			if session, err := s.auth.Authenticate(r.Context(), cookie.Value); err == nil {
				result["authenticated"] = true
				result["user"] = session.User
				result["csrfToken"] = session.CSRFToken
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": result})
}

type setupRequest struct {
	OrganizationName string `json:"organizationName"`
	OwnerName        string `json:"ownerName"`
	Username         string `json:"username"`
	Password         string `json:"password"`
}

func (s *server) setup(w http.ResponseWriter, r *http.Request) {
	var body setupRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	session, err := s.auth.Setup(r.Context(), auth.SetupInput{
		OrganizationName: body.OrganizationName,
		OwnerName:        body.OwnerName,
		Username:         body.Username,
		Password:         body.Password,
	})
	if errors.Is(err, auth.ErrSetupComplete) {
		writeError(w, http.StatusConflict, "setup_complete", err.Error())
		return
	}
	if err != nil {
		if isInputError(err) {
			writeError(w, http.StatusUnprocessableEntity, "validation_failed", err.Error())
			return
		}
		s.internalError(w, r, err)
		return
	}
	s.setSessionCookie(w, session)
	writeJSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"user": session.User, "csrfToken": session.CSRFToken}})
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if err := decodeJSON(w, r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	session, err := s.auth.Login(r.Context(), auth.LoginInput{Username: body.Username, Password: body.Password})
	if errors.Is(err, auth.ErrInvalidCredentials) || errors.Is(err, auth.ErrInactive) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "The username or password is incorrect.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.setSessionCookie(w, session)
	writeJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"user": session.User, "csrfToken": session.CSRFToken}})
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	session := r.Context().Value(sessionContextKey).(auth.Session)
	if err := s.auth.Logout(r.Context(), session.Token, session.User.ID); err != nil {
		s.internalError(w, r, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: s.cookieName, Value: "", Path: "/", HttpOnly: true, Secure: s.secureCookies, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(s.cookieName)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication is required.")
			return
		}
		session, err := s.auth.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "authentication_required", "Authentication is required.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionContextKey, session)))
	})
}

func (s *server) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session := r.Context().Value(sessionContextKey).(auth.Session)
		provided := r.Header.Get("X-CSRF-Token")
		if len(provided) != len(session.CSRFToken) || subtle.ConstantTimeCompare([]byte(provided), []byte(session.CSRFToken)) != 1 {
			writeError(w, http.StatusForbidden, "csrf_failed", "The request could not be verified.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) requireReleasePublisher(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if credential, ok := parseAuthorization(r.Header.Get("Authorization"), "Bearer"); ok {
			provided := sha256.Sum256([]byte(credential))
			if !s.releasePublishTokenConfigured || subtle.ConstantTimeCompare(provided[:], s.releasePublishTokenHash[:]) != 1 {
				writeError(w, http.StatusUnauthorized, "release_publish_token_invalid", "The release publishing token is invalid.")
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		s.requireSession(s.requireRoles("owner")(s.requireCSRF(next))).ServeHTTP(w, r)
	})
}

func (s *server) setSessionCookie(w http.ResponseWriter, session auth.Session) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName, Value: session.Token, Path: "/", HttpOnly: true, Secure: s.secureCookies,
		SameSite: http.SameSiteStrictMode, Expires: session.ExpiresAt, MaxAge: int(time.Until(session.ExpiresAt).Seconds()),
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		category := "malformed"
		message := "Request body contains malformed JSON."
		if errors.Is(err, io.EOF) {
			category, message = "missing", "Request body is missing."
		} else if strings.HasPrefix(err.Error(), "json: unknown field ") {
			category = "unsupported_field"
			field := strings.Trim(err.Error()[len("json: unknown field "):], `"`)
			message = "Unsupported request field: " + field + "."
		} else if typeError := new(json.UnmarshalTypeError); errors.As(err, &typeError) {
			category = "invalid_field_type"
			message = "Request field has an invalid value type: " + typeError.Field + "."
		}
		slog.Default().Warn("request JSON rejected", "error", err, "category", category, "request_id", middleware.GetReqID(r.Context()), "path", r.URL.Path)
		return errors.New(message)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("Request body must contain one JSON object.")
	}
	return nil
}

func (s *server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	s.logger.Error("request failed", "error", err, "request_id", middleware.GetReqID(r.Context()), "path", r.URL.Path)
	writeError(w, http.StatusInternalServerError, "internal_error", "Tilecast could not complete the request.")
}

func isInputError(err error) bool {
	message := err.Error()
	return strings.Contains(message, "must be") || strings.Contains(message, "characters")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
