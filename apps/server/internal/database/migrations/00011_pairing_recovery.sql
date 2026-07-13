-- +goose Up
ALTER TABLE device_pairing_sessions
    ADD COLUMN replace_existing_credential BOOLEAN NOT NULL DEFAULT FALSE;

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY player_installation_id ORDER BY created_at DESC, id DESC) AS position
    FROM device_pairing_sessions
    WHERE status IN ('pending', 'approved')
)
UPDATE device_pairing_sessions p SET status='expired'
FROM ranked r WHERE p.id=r.id AND r.position>1;

CREATE UNIQUE INDEX device_pairing_sessions_actionable_installation_idx
    ON device_pairing_sessions(player_installation_id)
    WHERE status IN ('pending', 'approved');

-- +goose Down
DROP INDEX device_pairing_sessions_actionable_installation_idx;
ALTER TABLE device_pairing_sessions DROP COLUMN replace_existing_credential;
