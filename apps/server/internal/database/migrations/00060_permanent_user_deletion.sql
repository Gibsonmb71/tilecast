-- +goose Up

-- Account-owned rows already cascade from users. Historical and operational
-- rows should remain after an account is permanently removed, with their user
-- attribution cleared.
ALTER TABLE upload_sessions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_created_by_fkey;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE takeovers DROP CONSTRAINT emergency_takeovers_activated_by_fkey;
ALTER TABLE takeovers ADD CONSTRAINT emergency_takeovers_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE takeovers DROP CONSTRAINT emergency_takeovers_cancelled_by_fkey;
ALTER TABLE takeovers ADD CONSTRAINT emergency_takeovers_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE player_commands DROP CONSTRAINT player_commands_created_by_fkey;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE organization_runtime_settings DROP CONSTRAINT organization_runtime_settings_updated_by_fkey;
ALTER TABLE organization_runtime_settings ADD CONSTRAINT organization_runtime_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE screen_group_player_policies DROP CONSTRAINT screen_group_player_policies_updated_by_fkey;
ALTER TABLE screen_group_player_policies ADD CONSTRAINT screen_group_player_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE screen_player_policies DROP CONSTRAINT screen_player_policies_updated_by_fkey;
ALTER TABLE screen_player_policies ADD CONSTRAINT screen_player_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE update_deployments DROP CONSTRAINT update_deployments_created_by_fkey;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE player_releases DROP CONSTRAINT player_releases_imported_by_fkey;
ALTER TABLE player_releases ADD CONSTRAINT player_releases_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE screen_power_assist_results DROP CONSTRAINT screen_power_assist_results_updated_by_fkey;
ALTER TABLE screen_power_assist_results ADD CONSTRAINT screen_power_assist_results_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;

-- +goose Down

ALTER TABLE screen_power_assist_results DROP CONSTRAINT screen_power_assist_results_updated_by_fkey;
ALTER TABLE screen_power_assist_results ADD CONSTRAINT screen_power_assist_results_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE player_releases DROP CONSTRAINT player_releases_imported_by_fkey;
ALTER TABLE player_releases ADD CONSTRAINT player_releases_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES users(id);
ALTER TABLE update_deployments DROP CONSTRAINT update_deployments_created_by_fkey;
ALTER TABLE update_deployments ADD CONSTRAINT update_deployments_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE screen_player_policies DROP CONSTRAINT screen_player_policies_updated_by_fkey;
ALTER TABLE screen_player_policies ADD CONSTRAINT screen_player_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE screen_group_player_policies DROP CONSTRAINT screen_group_player_policies_updated_by_fkey;
ALTER TABLE screen_group_player_policies ADD CONSTRAINT screen_group_player_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);
ALTER TABLE organization_runtime_settings DROP CONSTRAINT organization_runtime_settings_updated_by_fkey;
ALTER TABLE organization_runtime_settings ADD CONSTRAINT organization_runtime_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id);

ALTER TABLE player_commands DROP CONSTRAINT player_commands_created_by_fkey;
ALTER TABLE player_commands ADD CONSTRAINT player_commands_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE takeovers DROP CONSTRAINT emergency_takeovers_cancelled_by_fkey;
ALTER TABLE takeovers ADD CONSTRAINT emergency_takeovers_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES users(id);
ALTER TABLE takeovers DROP CONSTRAINT emergency_takeovers_activated_by_fkey;
ALTER TABLE takeovers ADD CONSTRAINT emergency_takeovers_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES users(id);

ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_created_by_fkey;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE upload_sessions ALTER COLUMN created_by SET NOT NULL;
