-- +goose Up
ALTER TABLE audit_logs
    ADD COLUMN result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied','partial')),
    ADD COLUMN resource_name TEXT,
    ADD COLUMN request_id TEXT,
    ADD COLUMN summary TEXT,
    ADD COLUMN metadata_sensitive BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX audit_logs_action_idx ON audit_logs(action, created_at DESC, id DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, created_at DESC, id DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs(user_id, created_at DESC, id DESC) WHERE user_id IS NOT NULL;
CREATE INDEX audit_logs_result_idx ON audit_logs(result, created_at DESC, id DESC);
-- +goose Down
DROP INDEX audit_logs_result_idx;
DROP INDEX audit_logs_user_idx;
DROP INDEX audit_logs_resource_idx;
DROP INDEX audit_logs_action_idx;
ALTER TABLE audit_logs DROP COLUMN metadata_sensitive,DROP COLUMN summary,DROP COLUMN request_id,DROP COLUMN resource_name,DROP COLUMN result;
