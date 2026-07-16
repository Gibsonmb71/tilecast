-- +goose Up
-- Replace the closed, enumerated provider lists with bounded ID-shape constraints. The
-- application catalog decides which providers are supported; the database only guards the
-- shape of the identifier so a new release-defined Widget or Data Source needs no schema
-- migration. The shape matches the catalog's identity rule: a lowercase letter followed by
-- up to 79 lowercase letters, digits, underscores, or hyphens.
ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_-]{0,79}$');

ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider ~ '^[a-z][a-z0-9_-]{0,79}$');

-- +goose Down
ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN (
        'calendar','rss','atom','json','csv','weather','manual',
        'transit','cap_alerts','air_quality','school-status'
    ));

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather',
        'spotlight','stat_grid','chart','progress','timeline','world_clock',
        'school-status-banner'
    ));
