-- +goose Up
-- Older installations may contain duplicate open rows from the race this
-- migration closes. Keep the newest row per screen and let the unique partial
-- index prevent a recurrence even if a future writer forgets the lock.
WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY screen_id ORDER BY started_at DESC, id DESC) AS rank
    FROM screen_state_intervals
    WHERE ended_at IS NULL
)
DELETE FROM screen_state_intervals intervals
USING ranked
WHERE intervals.id = ranked.id
  AND ranked.rank > 1;

CREATE UNIQUE INDEX screen_state_intervals_one_open_per_screen_idx
    ON screen_state_intervals(screen_id)
    WHERE ended_at IS NULL;

-- +goose Down
DROP INDEX screen_state_intervals_one_open_per_screen_idx;
