-- +goose Up
ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN ('calendar','rss','atom','json','csv','weather','manual'));

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather'
    ));

ALTER TABLE data_source_refresh_states
    ADD COLUMN upstream_last_modified TEXT,
    ADD COLUMN upstream_expires_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE data_source_refresh_states
    DROP COLUMN upstream_expires_at,
    DROP COLUMN upstream_last_modified;

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN ('website','youtube','clock','date','qrcode','ticker','menu','list','table','agenda'));

ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN ('calendar','rss','atom','json','csv'));
