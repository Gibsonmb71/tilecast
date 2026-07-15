-- +goose Up
CREATE TABLE activity_retention_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    raw_event_days INTEGER NOT NULL DEFAULT 60 CHECK (raw_event_days BETWEEN 7 AND 365),
    playback_session_days INTEGER NOT NULL DEFAULT 365 CHECK (playback_session_days BETWEEN 30 AND 2555),
    screen_state_days INTEGER NOT NULL DEFAULT 365 CHECK (screen_state_days BETWEEN 30 AND 2555),
    audit_log_days INTEGER NOT NULL DEFAULT 730 CHECK (audit_log_days BETWEEN 90 AND 3650),
    diagnostic_metadata_days INTEGER NOT NULL DEFAULT 30 CHECK (diagnostic_metadata_days BETWEEN 7 AND 180),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO activity_retention_settings(singleton) VALUES(TRUE);
-- +goose Down
DROP TABLE activity_retention_settings;
