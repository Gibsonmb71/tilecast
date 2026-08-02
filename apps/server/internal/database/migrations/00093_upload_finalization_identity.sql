-- +goose Up

-- final_asset_id is a recovery journal, not a live foreign-key relationship.
-- Finalization writes the generated identity before the Asset transaction so a
-- crash between storage movement and registration can be retried. A foreign
-- key would reject that durable journal entry before the referenced Asset
-- exists and would turn the recovery path back into the original orphan race.
ALTER TABLE upload_sessions
    DROP CONSTRAINT IF EXISTS upload_sessions_final_asset_id_fkey;

-- +goose Down

-- The constraint is deliberately not recreated: old finalizing rows may carry
-- an identity that is waiting for reconciliation, so restoring the FK would
-- make a rollback destructive to recoverability.
SELECT 1;
