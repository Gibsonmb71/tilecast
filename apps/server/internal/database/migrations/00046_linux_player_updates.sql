-- +goose Up

-- Add a platform dimension to player releases so Linux (AppImage) releases can
-- coexist with the original Android (APK) releases. Existing rows are Android.
--
-- The apk_size / apk_sha256 / apk_download_url columns are reused as the generic
-- artifact byte-size / SHA-256 / download URL for both platforms; only the naming
-- is Android-flavoured. Android keeps its original invariants (application_id,
-- minimum_sdk, apk_name); Linux carries a null application_id / minimum_sdk and the
-- AppImage asset name.

ALTER TABLE player_releases
    ADD COLUMN platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android','linux'));

ALTER TABLE player_releases
    ALTER COLUMN application_id DROP NOT NULL,
    ALTER COLUMN minimum_sdk DROP NOT NULL;

ALTER TABLE player_releases DROP CONSTRAINT player_releases_application_id_check;
ALTER TABLE player_releases DROP CONSTRAINT player_releases_minimum_sdk_check;
ALTER TABLE player_releases DROP CONSTRAINT player_releases_apk_name_check;

ALTER TABLE player_releases ADD CONSTRAINT player_releases_platform_shape_check CHECK (
    (platform = 'android'
        AND application_id = 'org.tilecast.player'
        AND minimum_sdk >= 23
        AND apk_name = 'tilecast-player.apk')
    OR
    (platform = 'linux'
        AND application_id IS NULL
        AND minimum_sdk IS NULL
        AND apk_name = 'tilecast-player.AppImage')
);

-- Version codes are only monotonic within a platform, so scope uniqueness to the
-- (platform, version_code) pair instead of globally.
ALTER TABLE player_releases DROP CONSTRAINT player_releases_version_code_key;
ALTER TABLE player_releases ADD CONSTRAINT player_releases_platform_version_code_key UNIQUE (platform, version_code);

-- +goose Down

DELETE FROM player_releases WHERE platform = 'linux';

ALTER TABLE player_releases DROP CONSTRAINT player_releases_platform_version_code_key;
ALTER TABLE player_releases ADD CONSTRAINT player_releases_version_code_key UNIQUE (version_code);

ALTER TABLE player_releases DROP CONSTRAINT player_releases_platform_shape_check;

ALTER TABLE player_releases ADD CONSTRAINT player_releases_apk_name_check CHECK (apk_name = 'tilecast-player.apk');
ALTER TABLE player_releases ADD CONSTRAINT player_releases_minimum_sdk_check CHECK (minimum_sdk >= 23);
ALTER TABLE player_releases ADD CONSTRAINT player_releases_application_id_check CHECK (application_id = 'org.tilecast.player');

ALTER TABLE player_releases
    ALTER COLUMN minimum_sdk SET NOT NULL,
    ALTER COLUMN application_id SET NOT NULL;

ALTER TABLE player_releases DROP COLUMN platform;
