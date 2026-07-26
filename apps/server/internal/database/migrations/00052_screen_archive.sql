-- +goose Up
ALTER TABLE screens
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX screens_archived_at_idx ON screens(archived_at DESC) WHERE archived_at IS NOT NULL;

-- Existing screens with no usable credential are already effectively revoked. Move
-- them into the archive and remove every live configuration relationship so they
-- cannot affect locations, groups, schedules, content usage, emergencies, or updates.
UPDATE screens s
SET archived_at = COALESCE(
        (SELECT max(c.revoked_at) FROM device_credentials c WHERE c.screen_id=s.id),
        s.updated_at,
        now()
    ),
    archived_reason = COALESCE(
        (SELECT NULLIF(c.revocation_reason, '')
         FROM device_credentials c
         WHERE c.screen_id=s.id AND c.revoked_at IS NOT NULL
         ORDER BY c.revoked_at DESC
         LIMIT 1),
        'Pairing revoked'
    ),
    enabled = FALSE,
    location_id = NULL,
    updated_at = now()
WHERE NOT EXISTS (
    SELECT 1 FROM device_credentials c
    WHERE c.screen_id=s.id AND c.revoked_at IS NULL
);

DELETE FROM screen_group_memberships
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

DELETE FROM screen_playlist_assignments
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

DELETE FROM schedule_targets
WHERE target_type='screen'
  AND screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

DELETE FROM emergency_targets
WHERE target_type='screen'
  AND screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

DELETE FROM update_deployment_targets
WHERE target_type='screen'
  AND screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

UPDATE player_commands
SET state='cancelled',
    completed_at=COALESCE(completed_at, now()),
    safe_result_code=COALESCE(safe_result_code, 'screen_archived'),
    safe_result_message=COALESCE(safe_result_message, 'The screen pairing was revoked.'),
    updated_at=now()
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL)
  AND state IN ('pending','delivered','acknowledged','running');

UPDATE emergency_screen_states
SET state='cancelled', last_updated_at=now()
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL)
  AND state IN ('pending','notified','preparing','ready','active','offline');

UPDATE screen_update_states
SET state='cancelled', completed_at=COALESCE(completed_at, now()), updated_at=now()
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL)
  AND state NOT IN ('succeeded','failed','cancelled','incompatible','already_current');

-- +goose Down
DROP INDEX screens_archived_at_idx;
ALTER TABLE screens
    DROP COLUMN archived_reason,
    DROP COLUMN archived_at;
