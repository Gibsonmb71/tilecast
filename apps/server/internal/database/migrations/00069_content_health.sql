-- +goose Up

-- Content health. Tilecast already records that a Data Source last succeeded
-- six days ago and is serving cache, and it already skips a Widget with
-- nothing to show. Nobody was told. A hallway board quietly showing last
-- week's lunch menu is a worse failure than a black screen, because it looks
-- fine, and the operator finds out from a person in the corridor.
--
-- These are conditions, so they are incidents: they open once, absorb repeats,
-- and recover on their own when the feed comes back. That also means they
-- reach the notification outbox with no new delivery machinery.
--
-- Deliberately NOT incidents: media that expires soon, and a screen with
-- nothing assigned. Neither is broken. Both appear in the content health
-- report, where a heads-up belongs, rather than paging somebody.

ALTER TABLE incidents DROP CONSTRAINT incidents_incident_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_incident_type_check
    CHECK (incident_type IN (
        'connectivity', 'playback', 'storage', 'safe_mode', 'update',
        -- A Data Source that is failing to refresh and is serving cache.
        'data_source',
        -- A playlist that is assigned to a screen and has nothing available
        -- to play right now.
        'content'
    ));

-- +goose Down

-- Conditions of the new types would violate the narrower constraint, so they
-- are closed rather than left to block the rollback.
DELETE FROM incident_events WHERE incident_id IN (
    SELECT id FROM incidents WHERE incident_type IN ('data_source', 'content'));
DELETE FROM incidents WHERE incident_type IN ('data_source', 'content');

ALTER TABLE incidents DROP CONSTRAINT incidents_incident_type_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_incident_type_check
    CHECK (incident_type IN ('connectivity', 'playback', 'storage', 'safe_mode', 'update'));
