package config

import "testing"

func TestLoadRequiresDatabaseURL(t *testing.T) {
	t.Setenv("TILECAST_DATABASE_URL", "")
	t.Setenv("TILECAST_ENV", "development")
	if _, err := Load(); err == nil {
		t.Fatal("expected missing database URL to fail")
	}
}

func TestCookieSecureMustBeBoolean(t *testing.T) {
	t.Setenv("TILECAST_DATABASE_URL", "postgres://example")
	t.Setenv("TILECAST_ENV", "production")
	t.Setenv("TILECAST_COOKIE_SECURE", "sometimes")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid cookie setting to fail")
	}
}

func TestDevelopmentDefaults(t *testing.T) {
	t.Setenv("TILECAST_DATABASE_URL", "postgres://example")
	t.Setenv("TILECAST_ENV", "development")
	t.Setenv("TILECAST_COOKIE_SECURE", "false")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.HTTPAddr != ":8080" || cfg.CookieName != "tilecast_session" {
		t.Fatalf("unexpected defaults: %#v", cfg)
	}
	if cfg.Media.MaxUploadBytes != 10737418240 || cfg.Media.Workers != 2 || cfg.Media.VideoMaxWidth != 1920 {
		t.Fatalf("unexpected media defaults: %#v", cfg.Media)
	}
}

func TestMediaConfigurationValidation(t *testing.T) {
	t.Setenv("TILECAST_DATABASE_URL", "postgres://example")
	t.Setenv("TILECAST_MEDIA_WORKERS", "0")
	if _, err := Load(); err == nil {
		t.Fatal("expected zero media workers to fail")
	}
	t.Setenv("TILECAST_MEDIA_WORKERS", "2")
	t.Setenv("TILECAST_MAX_UPLOAD_BYTES", "not-a-size")
	if _, err := Load(); err == nil {
		t.Fatal("expected invalid upload maximum to fail")
	}
}
