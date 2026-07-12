-- +goose Up
CREATE TABLE assets (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK (type IN ('image','video')),
    original_filename TEXT NOT NULL,
    declared_mime_type TEXT NOT NULL DEFAULT '',
    detected_mime_type TEXT NOT NULL,
    sha256 BYTEA NOT NULL,
    original_size BIGINT NOT NULL CHECK (original_size >= 0),
    width INTEGER,
    height INTEGER,
    duration_seconds DOUBLE PRECISION,
    frame_rate DOUBLE PRECISION,
    video_codec TEXT,
    audio_codec TEXT,
    audio_channels INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    processing_status TEXT NOT NULL CHECK (processing_status IN ('uploading','uploaded','queued','inspecting','processing','ready','failed','deleting','deleted')),
    processing_progress REAL CHECK (processing_progress IS NULL OR processing_progress BETWEEN 0 AND 1),
    error_code TEXT,
    error_message TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX assets_library_idx ON assets (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX assets_search_idx ON assets USING gin (to_tsvector('simple', name)) WHERE deleted_at IS NULL;

CREATE TABLE asset_variants (
    id UUID PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('original','playback','thumbnail','poster')),
    storage_provider TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    sha256 BYTEA NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_seconds DOUBLE PRECISION,
    frame_rate DOUBLE PRECISION,
    video_codec TEXT,
    audio_codec TEXT,
    player_compatible BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (asset_id, kind)
);
CREATE UNIQUE INDEX asset_variants_storage_key_unique ON asset_variants(storage_provider, storage_key) WHERE deleted_at IS NULL;

CREATE TABLE upload_sessions (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    original_filename TEXT NOT NULL,
    declared_mime_type TEXT NOT NULL DEFAULT '',
    expected_size BIGINT NOT NULL CHECK (expected_size > 0),
    current_offset BIGINT NOT NULL DEFAULT 0 CHECK (current_offset >= 0 AND current_offset <= expected_size),
    temporary_storage_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending','uploading','finalizing','finalized','failed','expired','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    resulting_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    failure_code TEXT
);
CREATE INDEX upload_sessions_cleanup_idx ON upload_sessions(status, expires_at);

CREATE TABLE media_jobs (
    id UUID PRIMARY KEY,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    upload_session_id UUID REFERENCES upload_sessions(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('inspect_asset','generate_image_thumbnail','generate_video_poster','optimize_video','delete_asset_files','clean_expired_uploads')),
    status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    progress REAL CHECK (progress IS NULL OR progress BETWEEN 0 AND 1),
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX media_jobs_claim_idx ON media_jobs(status, run_after, created_at);
CREATE UNIQUE INDEX media_jobs_active_unique ON media_jobs(asset_id, kind) WHERE status IN ('queued','running');

-- +goose StatementBegin
CREATE FUNCTION tilecast_valid_asset_transition(old_status TEXT, new_status TEXT) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE AS $$
    SELECT old_status = new_status OR (old_status, new_status) IN (
        ('uploading','uploaded'),('uploading','failed'),
        ('uploaded','queued'),('uploaded','failed'),('uploaded','deleting'),
        ('queued','inspecting'),('queued','processing'),('queued','failed'),('queued','deleting'),
        ('inspecting','processing'),('inspecting','ready'),('inspecting','failed'),('inspecting','deleting'),
        ('processing','ready'),('processing','failed'),('processing','deleting'),
        ('ready','deleting'),('failed','queued'),('failed','deleting'),
        ('deleting','deleted'),('deleting','failed')
    );
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION tilecast_enforce_asset_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT tilecast_valid_asset_transition(OLD.processing_status, NEW.processing_status) THEN
        RAISE EXCEPTION 'invalid asset status transition from % to %', OLD.processing_status, NEW.processing_status;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER assets_status_transition BEFORE UPDATE OF processing_status ON assets
FOR EACH ROW EXECUTE FUNCTION tilecast_enforce_asset_transition();

-- +goose StatementBegin
CREATE FUNCTION tilecast_valid_upload_transition(old_status TEXT, new_status TEXT) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE AS $$
    SELECT old_status = new_status OR (old_status, new_status) IN (
        ('pending','uploading'),('pending','finalizing'),('pending','cancelled'),('pending','expired'),('pending','failed'),
        ('uploading','finalizing'),('uploading','cancelled'),('uploading','expired'),('uploading','failed'),
        ('finalizing','finalized'),('finalizing','failed')
    );
$$;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE FUNCTION tilecast_enforce_upload_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NOT tilecast_valid_upload_transition(OLD.status, NEW.status) THEN
        RAISE EXCEPTION 'invalid upload status transition from % to %', OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER upload_sessions_status_transition BEFORE UPDATE OF status ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION tilecast_enforce_upload_transition();

-- +goose Down
DROP TRIGGER upload_sessions_status_transition ON upload_sessions;
DROP FUNCTION tilecast_enforce_upload_transition();
DROP FUNCTION tilecast_valid_upload_transition(TEXT, TEXT);
DROP TRIGGER assets_status_transition ON assets;
DROP FUNCTION tilecast_enforce_asset_transition();
DROP FUNCTION tilecast_valid_asset_transition(TEXT, TEXT);
DROP TABLE media_jobs;
DROP TABLE upload_sessions;
DROP TABLE asset_variants;
DROP TABLE assets;
