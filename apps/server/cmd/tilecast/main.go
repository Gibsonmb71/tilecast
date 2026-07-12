package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/tilecast/tilecast/apps/server/internal/auth"
	"github.com/tilecast/tilecast/apps/server/internal/config"
	"github.com/tilecast/tilecast/apps/server/internal/database"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
	"github.com/tilecast/tilecast/apps/server/internal/discovery"
	"github.com/tilecast/tilecast/apps/server/internal/httpapi"
	"github.com/tilecast/tilecast/apps/server/internal/media"
	"github.com/tilecast/tilecast/apps/server/internal/playlists"
	"github.com/tilecast/tilecast/apps/server/internal/scheduling"
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
	})
	playlistService := playlists.NewService(db, deviceService)
	schedulingService := scheduling.NewService(db, deviceService, scheduling.Limits{MaxSchedules: cfg.Scheduling.MaxSchedules, MaxTargetsPerSchedule: cfg.Scheduling.MaxTargetsPerSchedule, MaxGroupsPerScreen: cfg.Scheduling.MaxGroupsPerScreen, PrefetchDays: cfg.Scheduling.PrefetchDays, ActivationGraceSeconds: cfg.Scheduling.ActivationGraceSeconds, ClockSkewWarningSeconds: cfg.Scheduling.ClockSkewWarningSeconds})
	playlistService.SetScheduling(schedulingService)
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
		Auth:          authService,
		Devices:       deviceService,
		Media:         mediaService,
		Playlists:     playlistService,
		Scheduling:    schedulingService,
		DB:            db,
		Logger:        logger,
		CookieName:    cfg.CookieName,
		SecureCookies: cfg.CookieSecure,
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
