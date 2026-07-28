-- +goose Up

-- Player telemetry is deliberately bounded in three ways, because the failure
-- mode of fleet telemetry is unbounded growth:
--
--   1. the snapshot keeps only the latest value per screen — one row, updated;
--   2. events are emitted only on meaningful transitions, with hysteresis and
--      cooldowns, so a measurement oscillating around a threshold cannot spam;
--   3. samples are aggregated into five-minute rollups and the rollups expire.
--
-- Raw high-frequency samples are never stored.

CREATE TABLE screen_telemetry_snapshots (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    current_item_id TEXT NOT NULL DEFAULT '',
    item_started_at TIMESTAMPTZ,
    -- From the render-progress detector, not from renderer liveness.
    last_meaningful_progress_at TIMESTAMPTZ,
    playback_stall_duration_ms BIGINT CHECK (playback_stall_duration_ms IS NULL OR playback_stall_duration_ms >= 0),
    stall_reason TEXT NOT NULL DEFAULT '',
    renderer_state TEXT NOT NULL DEFAULT '',
    renderer_responding BOOLEAN,
    expected_motion BOOLEAN,

    server_round_trip_ms INTEGER CHECK (server_round_trip_ms IS NULL OR server_round_trip_ms >= 0),
    download_queue_count INTEGER CHECK (download_queue_count IS NULL OR download_queue_count >= 0),
    bytes_remaining BIGINT CHECK (bytes_remaining IS NULL OR bytes_remaining >= 0),
    cache_used_bytes BIGINT CHECK (cache_used_bytes IS NULL OR cache_used_bytes >= 0),
    cache_limit_bytes BIGINT CHECK (cache_limit_bytes IS NULL OR cache_limit_bytes >= 0),
    free_storage_bytes BIGINT CHECK (free_storage_bytes IS NULL OR free_storage_bytes >= 0),

    process_uptime_seconds BIGINT CHECK (process_uptime_seconds IS NULL OR process_uptime_seconds >= 0),
    device_uptime_seconds BIGINT CHECK (device_uptime_seconds IS NULL OR device_uptime_seconds >= 0),
    sync_group_drift_ms INTEGER,

    -- A short hash, never image data. Enough to tell "changed" from "identical"
    -- without Activity holding a picture of anyone's screen.
    frame_fingerprint TEXT NOT NULL DEFAULT '',
    average_luminance REAL CHECK (average_luminance IS NULL OR (average_luminance >= 0 AND average_luminance <= 1)),
    thermal_state TEXT NOT NULL DEFAULT '',
    memory_pressure_state TEXT NOT NULL DEFAULT '',

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hysteresis and cooldown bookkeeping. Kept server-side so a player that
-- restarts cannot re-announce every condition it was already in.
CREATE TABLE screen_telemetry_conditions (
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    condition TEXT NOT NULL,
    -- Whether the condition is currently held. A transition event is emitted
    -- only when this flips.
    active BOOLEAN NOT NULL,
    entered_at TIMESTAMPTZ,
    exited_at TIMESTAMPTZ,
    -- When the last event for this condition was emitted, which is what the
    -- cooldown is measured from.
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurrence_count BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (screen_id, condition)
);

CREATE TABLE screen_telemetry_rollups (
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    -- Aligned to a five-minute boundary, so repeated writes in one bucket
    -- update rather than accumulate rows.
    bucket_start TIMESTAMPTZ NOT NULL,

    samples INTEGER NOT NULL DEFAULT 0 CHECK (samples >= 0),
    average_round_trip_ms REAL,
    max_round_trip_ms INTEGER,
    connected_seconds INTEGER NOT NULL DEFAULT 0 CHECK (connected_seconds >= 0),
    disconnected_seconds INTEGER NOT NULL DEFAULT 0 CHECK (disconnected_seconds >= 0),
    healthy_playback_seconds INTEGER NOT NULL DEFAULT 0 CHECK (healthy_playback_seconds >= 0),
    stalled_playback_seconds INTEGER NOT NULL DEFAULT 0 CHECK (stalled_playback_seconds >= 0),
    black_output_seconds INTEGER NOT NULL DEFAULT 0 CHECK (black_output_seconds >= 0),
    dropped_frames BIGINT NOT NULL DEFAULT 0 CHECK (dropped_frames >= 0),
    frame_change_count BIGINT NOT NULL DEFAULT 0 CHECK (frame_change_count >= 0),
    downloaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK (downloaded_bytes >= 0),
    cache_hits BIGINT NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
    cache_misses BIGINT NOT NULL DEFAULT 0 CHECK (cache_misses >= 0),
    average_memory_bytes BIGINT,
    peak_memory_bytes BIGINT,
    average_cpu_percent REAL CHECK (average_cpu_percent IS NULL OR average_cpu_percent >= 0),
    -- Seconds spent in each thermal state, as a small bounded object.
    thermal_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
    sync_drift_p50_ms INTEGER,
    sync_drift_p95_ms INTEGER,
    sync_drift_max_ms INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (screen_id, bucket_start)
);

CREATE INDEX screen_telemetry_rollups_time_idx ON screen_telemetry_rollups(bucket_start DESC);

-- Rollups are the only telemetry that accumulates, so they get their own
-- retention bound alongside the existing Activity ones.
ALTER TABLE activity_retention_settings
    ADD COLUMN telemetry_rollup_days INTEGER NOT NULL DEFAULT 30
        CHECK (telemetry_rollup_days BETWEEN 7 AND 400);

-- +goose Down
ALTER TABLE activity_retention_settings DROP COLUMN telemetry_rollup_days;
DROP TABLE screen_telemetry_rollups;
DROP TABLE screen_telemetry_conditions;
DROP TABLE screen_telemetry_snapshots;
