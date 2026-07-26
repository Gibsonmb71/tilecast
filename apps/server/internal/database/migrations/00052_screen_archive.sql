-- +goose Up
ALTER TABLE screens
    ADD COLUMN archived_at TIMESTAMPTZ,
    ADD COLUMN archived_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX screens_archived_at_idx ON screens(archived_at DESC) WHERE archived_at IS NOT NULL;

-- Existing screens whose credentials were all revoked are already effectively
-- archived. Detach every live configuration relationship so they cannot affect
-- locations, groups, schedules, content usage, emergencies, or updates.
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
WHERE EXISTS (
    SELECT 1 FROM device_credentials c WHERE c.screen_id=s.id
)
AND NOT EXISTS (
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

DELETE FROM screen_player_policies
WHERE screen_id IN (SELECT id FROM screens WHERE archived_at IS NOT NULL);

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

CREATE FUNCTION reject_archived_screen_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.screen_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM screens WHERE id=NEW.screen_id AND archived_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'archived screens cannot receive live assignments'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER screen_group_memberships_reject_archived
    BEFORE INSERT OR UPDATE ON screen_group_memberships
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER screen_playlist_assignments_reject_archived
    BEFORE INSERT OR UPDATE ON screen_playlist_assignments
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER schedule_targets_reject_archived
    BEFORE INSERT OR UPDATE ON schedule_targets
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER emergency_targets_reject_archived
    BEFORE INSERT OR UPDATE ON emergency_targets
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER update_deployment_targets_reject_archived
    BEFORE INSERT OR UPDATE ON update_deployment_targets
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER player_commands_reject_archived
    BEFORE INSERT ON player_commands
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();
CREATE TRIGGER screen_player_policies_reject_archived
    BEFORE INSERT OR UPDATE ON screen_player_policies
    FOR EACH ROW EXECUTE FUNCTION reject_archived_screen_reference();

-- +goose Down
DROP TRIGGER screen_player_policies_reject_archived ON screen_player_policies;
DROP TRIGGER player_commands_reject_archived ON player_commands;
DROP TRIGGER update_deployment_targets_reject_archived ON update_deployment_targets;
DROP TRIGGER emergency_targets_reject_archived ON emergency_targets;
DROP TRIGGER schedule_targets_reject_archived ON schedule_targets;
DROP TRIGGER screen_playlist_assignments_reject_archived ON screen_playlist_assignments;
DROP TRIGGER screen_group_memberships_reject_archived ON screen_group_memberships;
DROP FUNCTION reject_archived_screen_reference();
DROP INDEX screens_archived_at_idx;
ALTER TABLE screens
    DROP COLUMN archived_reason,
    DROP COLUMN archived_at;
