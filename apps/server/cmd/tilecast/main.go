package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/config"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/discovery"
	"github.com/tilecast/tilecast/apps/server/internal/httpapi"
	"github.com/tilecast/tilecast/apps/server/internal/media"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
	"github.com/tilecast/tilecast/apps/server/internal/settings"
	"github.com/tilecast/tilecast/apps/server/internal/updates"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fail("configuration is invalid", err)
	}

	logger := newLogger(cfg.LogLevel)
	ctx := context.Background()

	if err := database.Migrate(ctx, cfg.DatabaseURL); err != nil {
		fail("database migration failed", err)
	}

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		fail("database connection failed", err)
	}
	defer db.Close()

	authService := auth.NewService(db, cfg.SessionTTL)
	presence := devices.NewPresenceHub()
	deviceService := devices.NewService(db, presence, cfg.PublicURL)
	mediaStorage, err := media.NewLocalStorage(cfg.Media.Root)
	if err != nil {
		fail("media storage initialization failed", err)
	}
	if err := media.ValidateExecutable(cfg.Media.FFmpegPath); err != nil {
		fail("FFmpeg validation failed", err)
	}
	if err := media.ValidateExecutable(cfg.Media.FFprobePath); err != nil {
		fail("FFprobe validation failed", err)
	}
	mediaService := media.NewService(db, mediaStorage, media.Config{
		MaxUploadBytes: cfg.Media.MaxUploadBytes, ReservedFreeBytes: cfg.Media.ReservedFreeBytes,
		FFmpegPath: cfg.Media.FFmpegPath, FFprobePath: cfg.Media.FFprobePath,
		Profile: media.CompatibilityProfile{MaxWidth: cfg.Media.VideoMaxWidth, MaxHeight: cfg.Media.VideoMaxHeight, MaxFrameRate: cfg.Media.VideoMaxFrameRate},
		Workers: cfg.Media.Workers, KeepOriginals: cfg.Media.KeepOriginals,
		Website: media.WebsitePolicy{AllowPrivateHTTP: cfg.Website.AllowPrivateHTTP, DefaultTimeoutSeconds: cfg.Website.DefaultTimeoutSeconds, MaxTimeoutSeconds: cfg.Website.MaxTimeoutSeconds, MinRefreshSeconds: cfg.Website.MinRefreshSeconds, MaxAllowedHosts: cfg.Website.MaxAllowedHosts, MaxWebsites: cfg.Website.MaxWebsites},
	})
	playlistService := playlists.NewService(db, deviceService)
	mediaService.SetAssetInvalidator(playlistService)
	schedulingService := scheduling.NewService(db, deviceService, scheduling.Limits{MaxSchedules: cfg.Scheduling.MaxSchedules, MaxTargetsPerSchedule: cfg.Scheduling.MaxTargetsPerSchedule, MaxGroupsPerScreen: cfg.Scheduling.MaxGroupsPerScreen, PrefetchDays: cfg.Scheduling.PrefetchDays, ActivationGraceSeconds: cfg.Scheduling.ActivationGraceSeconds, ClockSkewWarningSeconds: cfg.Scheduling.ClockSkewWarningSeconds})
	playlistService.SetScheduling(schedulingService)
	settingsService := settings.NewService(db, deviceService, settings.HardLimits{MaxUploadBytes: cfg.Media.MaxUploadBytes, MaxEmergencyMinutes: cfg.Operations.MaxEmergencyDurationHours * 60, MaxWebsiteTimeout: cfg.Website.MaxTimeoutSeconds, MaxPrefetchDays: cfg.Scheduling.PrefetchDays, PrivateHTTPAllowed: cfg.Website.AllowPrivateHTTP})
	updateService, updateErr := updates.NewService(db, updates.NewGitHubProvider(cfg.Updates.GitHubToken), updates.Config{Root: cfg.Updates.Root, TrustedPublicKey: cfg.Updates.TrustedPublicKey, MaxAPKBytes: cfg.Updates.MaxAPKBytes, GitHubClientID: cfg.Updates.GitHubClientID, GitHubTokenConfigured: strings.TrimSpace(cfg.Updates.GitHubToken) != ""})
	if updateErr != nil {
		fail("initialize player update service", updateErr)
	}
	_, _ = db.Exec(ctx, `INSERT INTO media_jobs(id,kind,status,run_after) VALUES(gen_random_uuid(),'clean_expired_uploads','queued',now())`)
	mediaWorkers := media.NewWorkerPool(mediaService, logger)
	mediaWorkers.Start(ctx)
	defer mediaWorkers.Stop()
	if cfg.MDNSEnabled {
		identity, identityErr := deviceService.Identity(ctx)
		if identityErr != nil {
			fail("read server identity for discovery", identityErr)
		}
		if identity.InstallationID == "" {
			logger.Info("mDNS discovery will begin after initial setup and a server restart")
		} else {
			discoveryServer, discoveryErr := discovery.Advertise(identity, cfg.PublicURL)
			if discoveryErr != nil {
				logger.Warn("mDNS discovery is unavailable", "error", discoveryErr)
			} else {
				defer discoveryServer.Shutdown()
				logger.Info("advertising Tilecast on the local network", "service", "_tilecast._tcp.local")
			}
		}
	}
	handler := httpapi.New(httpapi.Dependencies{
		Auth:                authService,
		Devices:             deviceService,
		Media:               mediaService,
		Playlists:           playlistService,
		Scheduling:          schedulingService,
		Settings:            settingsService,
		Updates:             updateService,
		DB:                  db,
		Logger:              logger,
		CookieName:          cfg.CookieName,
		SecureCookies:       cfg.CookieSecure,
		ReleasePublishToken: cfg.Updates.PublishToken,
		Operations: httpapi.OperationsConfig{
			MaxEmergencyDurationHours:   cfg.Operations.MaxEmergencyDurationHours,
			MaxEmergencyTargets:         cfg.Operations.MaxEmergencyTargets,
			MaxPendingCommands:          cfg.Operations.MaxPendingCommands,
			DefaultCommandExpiryMinutes: cfg.Operations.DefaultCommandExpiryMinutes,
			MaxIdentifySeconds:          cfg.Operations.MaxIdentifySeconds,
			CommandRetentionDays:        cfg.Operations.CommandRetentionDays,
		},
	})

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       0,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-shutdownCtx.Done():
				return
			case <-ticker.C:
				updateService.Cleanup(shutdownCtx, cfg.Updates.RetentionDays)
				_, _ = db.Exec(shutdownCtx, `UPDATE player_commands SET state='expired',completed_at=now(),updated_at=now() WHERE state IN ('pending','delivered','acknowledged','running') AND expires_at<=now()`)
				_, _ = db.Exec(shutdownCtx, `DELETE FROM player_commands WHERE completed_at<now()-make_interval(days=>COALESCE((SELECT (settings->>'retention.command_history_days')::int FROM organization_runtime_settings),$1))`, cfg.Operations.CommandRetentionDays)
				_, _ = db.Exec(shutdownCtx, `DELETE FROM audit_logs WHERE created_at<now()-make_interval(days=>COALESCE((SELECT (settings->>'retention.audit_days')::int FROM organization_runtime_settings),365))`)
				rows, err := db.Query(shutdownCtx, `WITH expired AS (UPDATE emergency_takeovers SET status='expired',updated_at=now() WHERE status='active' AND expires_at<=now() RETURNING id), affected AS (UPDATE emergency_screen_states SET state='expired',restored_at=now(),last_updated_at=now() WHERE emergency_id IN(SELECT id FROM expired) RETURNING screen_id), bumped AS (UPDATE screen_manifest_state SET manifest_version=manifest_version+1,changed_at=now(),change_reason='emergency.expired' WHERE screen_id IN(SELECT DISTINCT screen_id FROM affected) RETURNING screen_id,manifest_version) SELECT screen_id,manifest_version FROM bumped`)
				if err == nil {
					for rows.Next() {
						var screen uuid.UUID
						var version int64
						if rows.Scan(&screen, &version) == nil {
							deviceService.Notify(screen, map[string]any{"type": "emergency.changed", "manifestVersion": version})
							deviceService.Notify(screen, map[string]any{"type": "manifest.changed", "manifestVersion": version})
						}
					}
					rows.Close()
				}
			}
		}
	}()

	go func() {
		logger.Info("Tilecast server listening", "address", cfg.HTTPAddr, "environment", cfg.Environment)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fail("server stopped unexpectedly", err)
		}
	}()

	<-shutdownCtx.Done()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}

func newLogger(level string) *slog.Logger {
	var parsed slog.Level
	if err := parsed.UnmarshalText([]byte(level)); err != nil {
		parsed = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: parsed}))
}

func fail(message string, err error) {
	slog.Error(message, "error", err)
	os.Exit(1)
}
