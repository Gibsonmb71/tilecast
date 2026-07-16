-- +goose Up
ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather',
        'spotlight','stat_grid','chart','progress','timeline','world_clock',
        'school-status-banner'
    ));

ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN (
        'calendar','rss','atom','json','csv','weather','manual',
        'transit','cap_alerts','air_quality','school-status'
    ));

-- +goose Down
ALTER TABLE data_sources DROP CONSTRAINT data_sources_provider_check;
ALTER TABLE data_sources ADD CONSTRAINT data_sources_provider_check
    CHECK (provider IN (
        'calendar','rss','atom','json','csv','weather','manual',
        'transit','cap_alerts','air_quality'
    ));

ALTER TABLE widgets DROP CONSTRAINT widgets_provider_check;
ALTER TABLE widgets ADD CONSTRAINT widgets_provider_check
    CHECK (provider IN (
        'website','youtube','clock','date','qrcode','countdown',
        'ticker','menu','list','table','agenda','metric','cards','weather',
        'spotlight','stat_grid','chart','progress','timeline','world_clock'
    ));
