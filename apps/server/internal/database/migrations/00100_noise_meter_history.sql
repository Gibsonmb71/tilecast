-- +goose Up

-- History is opt-out per Noise Meter instance. Retention is a small closed set
-- rather than a free integer so an operator cannot configure a window the
-- pruning worker and the Player's local queue disagree about.
ALTER TABLE noise_meter_instances
    ADD COLUMN history_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN history_retention_days INTEGER NOT NULL DEFAULT 7
        CHECK (history_retention_days IN (1, 3, 7, 14, 30)),
    ADD COLUMN history_active_hours_only BOOLEAN NOT NULL DEFAULT TRUE;

-- The live meter's own state, for player health and debugging. It arrives on the
-- ordinary heartbeat like every other player status field and is a single
-- current value, never a series.
ALTER TABLE screen_player_status
    ADD COLUMN noise_meter_status TEXT,
    ADD COLUMN noise_meter_level REAL,
    ADD COLUMN noise_meter_reported_at TIMESTAMPTZ;

-- One row per completed ten-second bucket. These are derived numbers only:
-- there is no audio, no waveform, and no sample here, and there is no column
-- that could hold one.
--
-- The primary key is the idempotency key. A Player that never saw the response
-- to a heartbeat resends the same batch, and the same bucket lands on the same
-- row, so a retry is harmless rather than a duplicate.
CREATE TABLE noise_meter_history (
    -- The screen is the authenticated device, never a value from the request
    -- body: one Player must not be able to write another screen's history.
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    bucket_started_at TIMESTAMPTZ NOT NULL,
    -- The instance that was measuring. History belongs to the meter that
    -- recorded it, so deleting the instance takes its history with it.
    plugin_instance_id UUID REFERENCES noise_meter_instances(id) ON DELETE CASCADE,
    -- Relative 0-100 Tilecast noise levels. Not dB, dBA, or SPL.
    average_level REAL NOT NULL CHECK (average_level BETWEEN 0 AND 100),
    peak_level REAL NOT NULL CHECK (peak_level BETWEEN 0 AND 100),
    -- Milliseconds inside the bucket. monitored_ms is how much of the bucket the
    -- microphone actually covered, so a partly-monitored bucket cannot be read
    -- as ten full seconds of quiet.
    monitored_ms INTEGER NOT NULL CHECK (monitored_ms BETWEEN 0 AND 10000),
    warning_ms INTEGER NOT NULL CHECK (warning_ms BETWEEN 0 AND 10000),
    loud_ms INTEGER NOT NULL CHECK (loud_ms BETWEEN 0 AND 10000),
    -- Times the Player's own state machine entered its loud state during the
    -- bucket. Counted where it happens; a warning event cannot be recovered
    -- later by looking at averages.
    trigger_count SMALLINT NOT NULL DEFAULT 0 CHECK (trigger_count BETWEEN 0 AND 1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (screen_id, bucket_started_at)
);

-- The plugin History page reads by instance and range; pruning reads by age.
CREATE INDEX noise_meter_history_instance_idx
    ON noise_meter_history (plugin_instance_id, bucket_started_at);
CREATE INDEX noise_meter_history_age_idx
    ON noise_meter_history (bucket_started_at);

-- +goose Down

DROP TABLE noise_meter_history;

ALTER TABLE screen_player_status
    DROP COLUMN noise_meter_status,
    DROP COLUMN noise_meter_level,
    DROP COLUMN noise_meter_reported_at;

ALTER TABLE noise_meter_instances
    DROP COLUMN history_enabled,
    DROP COLUMN history_retention_days,
    DROP COLUMN history_active_hours_only;
