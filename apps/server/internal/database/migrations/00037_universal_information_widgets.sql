-- +goose Up
ALTER TABLE widgets
    ADD COLUMN preset_id TEXT;

ALTER TABLE widgets
    ADD CONSTRAINT widgets_preset_id_check CHECK (
        preset_id IS NULL OR preset_id IN (
            'leaderboard','status_board','queue_board',
            'schedule_departures','opening_hours','directory'
        )
    );

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather',
        'spotlight','stat_grid','chart','progress','timeline','world_clock'
    ));

ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN (
        'calendar','rss','atom','json','csv','weather','manual',
        'transit','cap_alerts','air_quality'
    ));

ALTER TABLE data_source_refresh_states
    ADD COLUMN secondary_cached_payload BYTEA,
    ADD COLUMN secondary_cache_expires_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE data_source_refresh_states
    DROP COLUMN secondary_cache_expires_at,
    DROP COLUMN secondary_cached_payload;

ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN ('calendar','rss','atom','json','csv','weather','manual'));

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather'
    ));

ALTER TABLE widgets DROP CONSTRAINT widgets_preset_id_check;
ALTER TABLE widgets DROP COLUMN preset_id;
