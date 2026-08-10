-- +goose Up

-- When the bar is allowed on screen.
--
-- Measurement and the display window are deliberately separate questions. A
-- room can be worth measuring all day while the bar is only wanted during
-- class; history keeps its own active-hours setting, and this governs the bar
-- alone.
--
-- The window is half-open [start, end) in an explicit IANA timezone, and an end
-- at or before the start is an overnight window belonging to the start day —
-- the same daily-window semantics active hours and content schedules use.
ALTER TABLE noise_meter_instances
    ADD COLUMN schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Sunday is 0 and Saturday is 6, matching Countdown Bar and schedules.
    ADD COLUMN schedule_days_of_week INTEGER[] NOT NULL DEFAULT '{}',
    ADD COLUMN schedule_start_time TIME,
    ADD COLUMN schedule_end_time TIME,
    ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'UTC',
    -- A window that is switched on without days or times would hide the bar
    -- permanently, which is never what an operator meant.
    ADD CONSTRAINT noise_meter_schedule_complete CHECK (
        NOT schedule_enabled
        OR (schedule_start_time IS NOT NULL
            AND schedule_end_time IS NOT NULL
            AND array_length(schedule_days_of_week, 1) BETWEEN 1 AND 7)
    );

-- +goose Down

ALTER TABLE noise_meter_instances
    DROP CONSTRAINT noise_meter_schedule_complete,
    DROP COLUMN schedule_enabled,
    DROP COLUMN schedule_days_of_week,
    DROP COLUMN schedule_start_time,
    DROP COLUMN schedule_end_time,
    DROP COLUMN schedule_timezone;
