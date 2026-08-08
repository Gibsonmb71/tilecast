-- +goose Up

-- A user-facing App may own one hidden Data Source while the ordinary Widget
-- configuration continues to reference it for dependency and manifest projection.
-- The author configuration is kept separately so Studio never has to expose the
-- managed resource ID as an editable field.
ALTER TABLE widgets
    ADD COLUMN app_configuration jsonb,
    ADD COLUMN managed_data_source_id uuid REFERENCES data_sources(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX widgets_managed_data_source_idx
    ON widgets(managed_data_source_id)
    WHERE managed_data_source_id IS NOT NULL;

-- +goose Down
DROP INDEX widgets_managed_data_source_idx;
ALTER TABLE widgets DROP COLUMN managed_data_source_id, DROP COLUMN app_configuration;
