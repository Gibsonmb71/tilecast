-- +goose Up

-- The Linux capability probe already knows which dependency failed and why.
-- Storing that sentence lets Studio name the missing piece instead of showing
-- one generic "not AirPlay-ready" for five different provisioning faults.
ALTER TABLE screen_player_status
    ADD COLUMN airplay_limitation TEXT;

-- +goose Down

ALTER TABLE screen_player_status
    DROP COLUMN airplay_limitation;
