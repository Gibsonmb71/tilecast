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
