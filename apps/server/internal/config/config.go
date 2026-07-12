package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Environment  string
	HTTPAddr     string
	DatabaseURL  string
	PublicURL    string
	CookieName   string
	CookieSecure bool
	SessionTTL   time.Duration
	LogLevel     string
	MDNSEnabled  bool
	Media        MediaConfig
	Scheduling   SchedulingConfig
	Website      WebsiteConfig
}

type WebsiteConfig struct {
	AllowPrivateHTTP                                                                          bool
	DefaultTimeoutSeconds, MaxTimeoutSeconds, MinRefreshSeconds, MaxAllowedHosts, MaxWebsites int
}

type SchedulingConfig struct {
	MaxSchedules            int
	MaxTargetsPerSchedule   int
	MaxGroupsPerScreen      int
	PrefetchDays            int
	ActivationGraceSeconds  int
	ClockSkewWarningSeconds int
}

type MediaConfig struct {
	Root              string
	MaxUploadBytes    int64
	Workers           int
	ReservedFreeBytes uint64
	FFmpegPath        string
	FFprobePath       string
	VideoMaxWidth     int
	VideoMaxHeight    int
	VideoMaxFrameRate float64
	KeepOriginals     bool
}

func Load() (Config, error) {
	cfg := Config{
		Environment: get("TILECAST_ENV", "development"),
		HTTPAddr:    get("TILECAST_HTTP_ADDR", ":8080"),
		DatabaseURL: os.Getenv("TILECAST_DATABASE_URL"),
		PublicURL:   get("TILECAST_PUBLIC_URL", "http://localhost:8080"),
		CookieName:  get("TILECAST_COOKIE_NAME", "tilecast_session"),
		LogLevel:    get("TILECAST_LOG_LEVEL", "info"),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("TILECAST_DATABASE_URL is required")
	}

	secure, err := strconv.ParseBool(get("TILECAST_COOKIE_SECURE", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("parse TILECAST_COOKIE_SECURE: %w", err)
	}
	cfg.CookieSecure = secure
	mdnsEnabled, err := strconv.ParseBool(get("TILECAST_MDNS_ENABLED", "true"))
	if err != nil {
		return Config{}, fmt.Errorf("parse TILECAST_MDNS_ENABLED: %w", err)
	}
	cfg.MDNSEnabled = mdnsEnabled
	values := []struct {
		name, fallback string
		max            int
		dest           *int
	}{
		{"TILECAST_MAX_SCHEDULES", "1000", 10000, &cfg.Scheduling.MaxSchedules},
		{"TILECAST_MAX_SCHEDULE_TARGETS", "250", 1000, &cfg.Scheduling.MaxTargetsPerSchedule},
		{"TILECAST_MAX_GROUPS_PER_SCREEN", "50", 500, &cfg.Scheduling.MaxGroupsPerScreen},
		{"TILECAST_SCHEDULE_PREFETCH_DAYS", "14", 365, &cfg.Scheduling.PrefetchDays},
		{"TILECAST_SCHEDULE_ACTIVATION_GRACE_SECONDS", "30", 3600, &cfg.Scheduling.ActivationGraceSeconds},
		{"TILECAST_CLOCK_SKEW_WARNING_SECONDS", "300", 86400, &cfg.Scheduling.ClockSkewWarningSeconds},
	}
	for _, value := range values {
		parsed, parseErr := parsePositiveInt64(value.name, value.fallback)
		if parseErr != nil || parsed > int64(value.max) {
			return Config{}, fmt.Errorf("%s must be between 1 and %d", value.name, value.max)
		}
		*value.dest = int(parsed)
	}
	cfg.Website.AllowPrivateHTTP, err = strconv.ParseBool(get("TILECAST_WEBSITE_ALLOW_PRIVATE_HTTP", "false"))
	if err != nil {
		return Config{}, fmt.Errorf("parse TILECAST_WEBSITE_ALLOW_PRIVATE_HTTP: %w", err)
	}
	websiteValues := []struct {
		name, fallback string
		max            int
		dest           *int
	}{{"TILECAST_WEBSITE_DEFAULT_TIMEOUT_SECONDS", "20", 120, &cfg.Website.DefaultTimeoutSeconds}, {"TILECAST_WEBSITE_MAX_TIMEOUT_SECONDS", "120", 600, &cfg.Website.MaxTimeoutSeconds}, {"TILECAST_WEBSITE_MIN_REFRESH_SECONDS", "30", 3600, &cfg.Website.MinRefreshSeconds}, {"TILECAST_WEBSITE_MAX_ALLOWED_HOSTS", "25", 100, &cfg.Website.MaxAllowedHosts}, {"TILECAST_WEBSITE_MAX_ASSETS", "500", 5000, &cfg.Website.MaxWebsites}}
	for _, value := range websiteValues {
		parsed, parseErr := parsePositiveInt64(value.name, value.fallback)
		if parseErr != nil || parsed > int64(value.max) {
			return Config{}, fmt.Errorf("%s must be between 1 and %d", value.name, value.max)
		}
		*value.dest = int(parsed)
	}
	if cfg.Website.DefaultTimeoutSeconds > cfg.Website.MaxTimeoutSeconds {
		return Config{}, errors.New("TILECAST_WEBSITE_DEFAULT_TIMEOUT_SECONDS must not exceed TILECAST_WEBSITE_MAX_TIMEOUT_SECONDS")
	}

	cfg.Media = MediaConfig{
		Root:        get("TILECAST_MEDIA_ROOT", "/data/media"),
		FFmpegPath:  get("TILECAST_FFMPEG_PATH", "/usr/bin/ffmpeg"),
		FFprobePath: get("TILECAST_FFPROBE_PATH", "/usr/bin/ffprobe"),
	}
	if cfg.Media.MaxUploadBytes, err = parsePositiveInt64("TILECAST_MAX_UPLOAD_BYTES", "10737418240"); err != nil {
		return Config{}, err
	}
	workers, err := parsePositiveInt64("TILECAST_MEDIA_WORKERS", "2")
	if err != nil || workers > 32 {
		return Config{}, errors.New("TILECAST_MEDIA_WORKERS must be between 1 and 32")
	}
	cfg.Media.Workers = int(workers)
	reserved, err := parsePositiveInt64("TILECAST_MEDIA_RESERVED_FREE_BYTES", "1073741824")
	if err != nil {
		return Config{}, err
	}
	cfg.Media.ReservedFreeBytes = uint64(reserved)
	maxWidth, err := parsePositiveInt64("TILECAST_VIDEO_MAX_WIDTH", "1920")
	if err != nil {
		return Config{}, err
	}
	cfg.Media.VideoMaxWidth = int(maxWidth)
	maxHeight, err := parsePositiveInt64("TILECAST_VIDEO_MAX_HEIGHT", "1080")
	if err != nil {
		return Config{}, err
	}
	cfg.Media.VideoMaxHeight = int(maxHeight)
	if cfg.Media.VideoMaxFrameRate, err = strconv.ParseFloat(get("TILECAST_VIDEO_MAX_FRAME_RATE", "60"), 64); err != nil || cfg.Media.VideoMaxFrameRate <= 0 {
		return Config{}, errors.New("TILECAST_VIDEO_MAX_FRAME_RATE must be positive")
	}
	if cfg.Media.KeepOriginals, err = strconv.ParseBool(get("TILECAST_KEEP_ORIGINALS", "true")); err != nil {
		return Config{}, fmt.Errorf("parse TILECAST_KEEP_ORIGINALS: %w", err)
	}

	ttl, err := time.ParseDuration(get("TILECAST_SESSION_TTL", "24h"))
	if err != nil || ttl < 15*time.Minute {
		return Config{}, errors.New("TILECAST_SESSION_TTL must be a duration of at least 15m")
	}
	cfg.SessionTTL = ttl

	return cfg, nil
}

func parsePositiveInt64(key, fallback string) (int64, error) {
	value, err := strconv.ParseInt(get(key, fallback), 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func get(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
