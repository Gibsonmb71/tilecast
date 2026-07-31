-- +goose Up

-- Diagnostic telemetry. The original telemetry tables answered "is this screen
-- playing"; these columns answer "why is it not", which previously required
-- physical access to the device.
--
-- The same three bounds as the original migration still hold: gauges keep only
-- the latest value per screen, counters accumulate into five-minute rollups,
-- and nothing here is free-form. Every text column is an allowlisted state or a
-- length-bounded identifier, so a player cannot use telemetry as arbitrary
-- storage, and no column can hold a URL, a hostname, a path, or an SSID.

ALTER TABLE screen_telemetry_snapshots
    -- Network path. A screen that is "offline" is usually a link problem, and
    -- until now the only network measurement was a round-trip time.
    ADD COLUMN network_link_type TEXT NOT NULL DEFAULT '',
    -- Received signal strength is negative by convention; the range is wide
    -- enough for any real radio and narrow enough to reject a bad unit.
    ADD COLUMN wifi_signal_dbm INTEGER
        CHECK (wifi_signal_dbm IS NULL OR wifi_signal_dbm BETWEEN -120 AND 0),
    ADD COLUMN wifi_link_speed_mbps INTEGER
        CHECK (wifi_link_speed_mbps IS NULL OR wifi_link_speed_mbps >= 0),
    ADD COLUMN gateway_reachable BOOLEAN,
    -- A captive portal looks identical to a working link from the radio's point
    -- of view, so the player's own verdict is recorded separately.
    ADD COLUMN captive_portal_suspected BOOLEAN,
    ADD COLUMN last_disconnect_reason TEXT NOT NULL DEFAULT '',

    -- Display and power. A dark screen with a healthy player is a display
    -- fault, and these are the fields that tell the two apart.
    ADD COLUMN display_connected BOOLEAN,
    ADD COLUMN display_resolution TEXT NOT NULL DEFAULT '',
    ADD COLUMN display_refresh_hz REAL
        CHECK (display_refresh_hz IS NULL OR (display_refresh_hz >= 0 AND display_refresh_hz <= 480)),
    ADD COLUMN display_power_state TEXT NOT NULL DEFAULT '',
    ADD COLUMN last_shutdown_reason TEXT NOT NULL DEFAULT '',
    ADD COLUMN power_source TEXT NOT NULL DEFAULT '',
    ADD COLUMN battery_percent INTEGER
        CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),

    -- Clock. Offline scheduling is evaluated on the device clock, so a drifting
    -- clock shows up as content playing at the wrong time and nothing else.
    -- Signed: a device can be behind or ahead.
    ADD COLUMN clock_offset_seconds INTEGER,
    ADD COLUMN time_sync_state TEXT NOT NULL DEFAULT '',

    -- Startup timing, one set per boot. "The screen takes minutes to come back
    -- after a power cut" is otherwise unattributable to a phase.
    ADD COLUMN startup_total_ms BIGINT CHECK (startup_total_ms IS NULL OR startup_total_ms >= 0),
    ADD COLUMN startup_config_ms BIGINT CHECK (startup_config_ms IS NULL OR startup_config_ms >= 0),
    ADD COLUMN startup_manifest_ms BIGINT CHECK (startup_manifest_ms IS NULL OR startup_manifest_ms >= 0),
    ADD COLUMN startup_asset_verify_ms BIGINT CHECK (startup_asset_verify_ms IS NULL OR startup_asset_verify_ms >= 0),
    ADD COLUMN startup_first_frame_ms BIGINT CHECK (startup_first_frame_ms IS NULL OR startup_first_frame_ms >= 0),

    -- Decode path. Silent hardware-to-software fallback is the usual cause of a
    -- screen that plays the same video acceptably on one device and badly on
    -- another identical one.
    ADD COLUMN video_decoder_path TEXT NOT NULL DEFAULT '',
    ADD COLUMN video_decoded_resolution TEXT NOT NULL DEFAULT '';

ALTER TABLE screen_telemetry_rollups
    -- Request outcomes, separated by class. One aggregate failure count cannot
    -- distinguish a revoked credential from an overloaded server.
    ADD COLUMN http_request_count BIGINT NOT NULL DEFAULT 0 CHECK (http_request_count >= 0),
    ADD COLUMN http_failure_count BIGINT NOT NULL DEFAULT 0 CHECK (http_failure_count >= 0),
    ADD COLUMN http_client_error_count BIGINT NOT NULL DEFAULT 0 CHECK (http_client_error_count >= 0),
    ADD COLUMN http_server_error_count BIGINT NOT NULL DEFAULT 0 CHECK (http_server_error_count >= 0),
    ADD COLUMN request_retry_count BIGINT NOT NULL DEFAULT 0 CHECK (request_retry_count >= 0),
    ADD COLUMN socket_reconnect_count BIGINT NOT NULL DEFAULT 0 CHECK (socket_reconnect_count >= 0),
    ADD COLUMN network_interface_change_count BIGINT NOT NULL DEFAULT 0
        CHECK (network_interface_change_count >= 0),
    -- Connection setup split from transfer, because a slow DNS resolver and a
    -- slow link need different fixes and both read as "the screen is slow".
    ADD COLUMN dns_resolve_p95_ms INTEGER CHECK (dns_resolve_p95_ms IS NULL OR dns_resolve_p95_ms >= 0),
    ADD COLUMN tls_handshake_p95_ms INTEGER CHECK (tls_handshake_p95_ms IS NULL OR tls_handshake_p95_ms >= 0),
    ADD COLUMN time_to_first_byte_p95_ms INTEGER
        CHECK (time_to_first_byte_p95_ms IS NULL OR time_to_first_byte_p95_ms >= 0),
    ADD COLUMN average_throughput_bytes_per_second BIGINT
        CHECK (average_throughput_bytes_per_second IS NULL OR average_throughput_bytes_per_second >= 0),

    -- Render timing. Dropped frames already existed, but a screen can hold its
    -- frame rate and still visibly stutter, which shows up here instead.
    ADD COLUMN frame_time_p95_ms REAL CHECK (frame_time_p95_ms IS NULL OR frame_time_p95_ms >= 0),
    ADD COLUMN frame_time_p99_ms REAL CHECK (frame_time_p99_ms IS NULL OR frame_time_p99_ms >= 0),
    ADD COLUMN jank_frame_count BIGINT NOT NULL DEFAULT 0 CHECK (jank_frame_count >= 0),
    ADD COLUMN renderer_crash_count BIGINT NOT NULL DEFAULT 0 CHECK (renderer_crash_count >= 0),
    ADD COLUMN surface_lost_count BIGINT NOT NULL DEFAULT 0 CHECK (surface_lost_count >= 0),
    ADD COLUMN decoder_init_failure_count BIGINT NOT NULL DEFAULT 0 CHECK (decoder_init_failure_count >= 0),

    -- Cache churn. Cache hits and misses said whether content was local;
    -- these say whether the cache is thrashing or corrupting.
    ADD COLUMN cache_eviction_count BIGINT NOT NULL DEFAULT 0 CHECK (cache_eviction_count >= 0),
    ADD COLUMN cache_evicted_bytes BIGINT NOT NULL DEFAULT 0 CHECK (cache_evicted_bytes >= 0),
    ADD COLUMN integrity_failure_count BIGINT NOT NULL DEFAULT 0 CHECK (integrity_failure_count >= 0),
    ADD COLUMN download_resume_count BIGINT NOT NULL DEFAULT 0 CHECK (download_resume_count >= 0),
    ADD COLUMN download_failure_count BIGINT NOT NULL DEFAULT 0 CHECK (download_failure_count >= 0),

    -- Power and display transitions. An unexpected reboot count is what turns
    -- "it goes blank sometimes" into a failing power supply.
    ADD COLUMN unexpected_reboot_count BIGINT NOT NULL DEFAULT 0 CHECK (unexpected_reboot_count >= 0),
    ADD COLUMN display_sleep_count BIGINT NOT NULL DEFAULT 0 CHECK (display_sleep_count >= 0),
    ADD COLUMN display_wake_count BIGINT NOT NULL DEFAULT 0 CHECK (display_wake_count >= 0);

-- +goose Down

ALTER TABLE screen_telemetry_rollups
    DROP COLUMN http_request_count,
    DROP COLUMN http_failure_count,
    DROP COLUMN http_client_error_count,
    DROP COLUMN http_server_error_count,
    DROP COLUMN request_retry_count,
    DROP COLUMN socket_reconnect_count,
    DROP COLUMN network_interface_change_count,
    DROP COLUMN dns_resolve_p95_ms,
    DROP COLUMN tls_handshake_p95_ms,
    DROP COLUMN time_to_first_byte_p95_ms,
    DROP COLUMN average_throughput_bytes_per_second,
    DROP COLUMN frame_time_p95_ms,
    DROP COLUMN frame_time_p99_ms,
    DROP COLUMN jank_frame_count,
    DROP COLUMN renderer_crash_count,
    DROP COLUMN surface_lost_count,
    DROP COLUMN decoder_init_failure_count,
    DROP COLUMN cache_eviction_count,
    DROP COLUMN cache_evicted_bytes,
    DROP COLUMN integrity_failure_count,
    DROP COLUMN download_resume_count,
    DROP COLUMN download_failure_count,
    DROP COLUMN unexpected_reboot_count,
    DROP COLUMN display_sleep_count,
    DROP COLUMN display_wake_count;

ALTER TABLE screen_telemetry_snapshots
    DROP COLUMN network_link_type,
    DROP COLUMN wifi_signal_dbm,
    DROP COLUMN wifi_link_speed_mbps,
    DROP COLUMN gateway_reachable,
    DROP COLUMN captive_portal_suspected,
    DROP COLUMN last_disconnect_reason,
    DROP COLUMN display_connected,
    DROP COLUMN display_resolution,
    DROP COLUMN display_refresh_hz,
    DROP COLUMN display_power_state,
    DROP COLUMN last_shutdown_reason,
    DROP COLUMN power_source,
    DROP COLUMN battery_percent,
    DROP COLUMN clock_offset_seconds,
    DROP COLUMN time_sync_state,
    DROP COLUMN startup_total_ms,
    DROP COLUMN startup_config_ms,
    DROP COLUMN startup_manifest_ms,
    DROP COLUMN startup_asset_verify_ms,
    DROP COLUMN startup_first_frame_ms,
    DROP COLUMN video_decoder_path,
    DROP COLUMN video_decoded_resolution;
