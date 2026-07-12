-- +goose Up
CREATE TABLE playlists (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX playlists_library_idx ON playlists(organization_id, updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE playlist_items (
    id UUID PRIMARY KEY,
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position >= 0),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms > 0),
    fit_mode TEXT NOT NULL DEFAULT 'contain' CHECK (fit_mode IN ('contain','cover','stretch')),
    transition TEXT NOT NULL DEFAULT 'none' CHECK (transition IN ('none','fade')),
    audio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    volume REAL NOT NULL DEFAULT 1 CHECK (volume BETWEEN 0 AND 1),
    video_start_offset_ms BIGINT CHECK (video_start_offset_ms IS NULL OR video_start_offset_ms >= 0),
    video_end_offset_ms BIGINT CHECK (video_end_offset_ms IS NULL OR video_end_offset_ms > 0),
    delivery_policy TEXT NOT NULL DEFAULT 'download' CHECK (delivery_policy IN ('download','stream','automatic')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(playlist_id, position)
);
CREATE INDEX playlist_items_asset_idx ON playlist_items(asset_id);

CREATE TABLE screen_playlist_assignments (
    id UUID PRIMARY KEY,
    screen_id UUID NOT NULL UNIQUE REFERENCES screens(id) ON DELETE CASCADE,
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE RESTRICT,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX screen_playlist_assignments_playlist_idx ON screen_playlist_assignments(playlist_id);

CREATE TABLE screen_manifest_state (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    manifest_version BIGINT NOT NULL DEFAULT 1 CHECK (manifest_version > 0),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_reason TEXT NOT NULL DEFAULT 'initial',
    previous_manifest_version BIGINT,
    last_requested_at TIMESTAMPTZ
);

CREATE TABLE screen_player_status (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    active_manifest_version BIGINT,
    pending_manifest_version BIGINT,
    assigned_playlist_id UUID,
    current_item_id UUID,
    current_asset_id UUID,
    playback_state TEXT,
    download_queue_count INTEGER,
    downloaded_bytes BIGINT,
    required_bytes BIGINT,
    cache_used_bytes BIGINT,
    cache_limit_bytes BIGINT,
    last_sync_error TEXT,
    last_playback_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE screen_player_status;
DROP TABLE screen_manifest_state;
DROP TABLE screen_playlist_assignments;
DROP TABLE playlist_items;
DROP TABLE playlists;
