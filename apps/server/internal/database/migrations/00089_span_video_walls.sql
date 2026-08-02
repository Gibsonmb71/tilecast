-- +goose Up

-- Span keeps the existing screen-group tables and adds only the geometry that
-- makes a group a single logical canvas. Mirror groups leave these fields
-- inert, so existing installations keep their current manifest shape.
ALTER TABLE screen_groups
    ADD COLUMN span_canvas_width INTEGER NOT NULL DEFAULT 1920,
    ADD COLUMN span_canvas_height INTEGER NOT NULL DEFAULT 1080,
    ADD COLUMN span_geometry_revision BIGINT NOT NULL DEFAULT 1;

ALTER TABLE screen_groups
    ADD CONSTRAINT screen_groups_span_canvas_check
    CHECK (span_canvas_width BETWEEN 320 AND 16384 AND span_canvas_height BETWEEN 320 AND 16384),
    ADD CONSTRAINT screen_groups_span_revision_check
    CHECK (span_geometry_revision > 0);

CREATE TABLE screen_group_panels (
    screen_group_id UUID NOT NULL REFERENCES screen_groups(id) ON DELETE CASCADE,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    panel_order INTEGER NOT NULL CHECK (panel_order BETWEEN 0 AND 999),
    x INTEGER NOT NULL CHECK (x >= 0),
    y INTEGER NOT NULL CHECK (y >= 0),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 16384),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 16384),
    rotation INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
    bezel_left INTEGER NOT NULL DEFAULT 0 CHECK (bezel_left BETWEEN 0 AND 500),
    bezel_top INTEGER NOT NULL DEFAULT 0 CHECK (bezel_top BETWEEN 0 AND 500),
    bezel_right INTEGER NOT NULL DEFAULT 0 CHECK (bezel_right BETWEEN 0 AND 500),
    bezel_bottom INTEGER NOT NULL DEFAULT 0 CHECK (bezel_bottom BETWEEN 0 AND 500),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (screen_group_id, screen_id),
    UNIQUE (screen_group_id, panel_order)
);
CREATE INDEX screen_group_panels_screen_idx ON screen_group_panels(screen_id, screen_group_id);

-- Span video outputs are not ordinary library variants: there can be one
-- deterministic output per wall panel for the same source asset. They remain
-- addressable by the authenticated Player path and are retained until the
-- source or geometry changes.
CREATE TABLE span_video_panels (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    screen_group_id UUID NOT NULL REFERENCES screen_groups(id) ON DELETE CASCADE,
    screen_id UUID NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    source_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    source_variant_id UUID NOT NULL REFERENCES asset_variants(id) ON DELETE CASCADE,
    geometry_revision BIGINT NOT NULL,
    geometry_hash TEXT NOT NULL CHECK (geometry_hash ~ '^[a-f0-9]{64}$'),
    storage_key TEXT,
    mime_type TEXT NOT NULL DEFAULT 'video/mp4',
    file_size BIGINT CHECK (file_size IS NULL OR file_size >= 0),
    sha256 BYTEA,
    width INTEGER CHECK (width IS NULL OR width BETWEEN 1 AND 16384),
    height INTEGER CHECK (height IS NULL OR height BETWEEN 1 AND 16384),
    duration_seconds DOUBLE PRECISION CHECK (duration_seconds IS NULL OR duration_seconds > 0),
    frame_rate DOUBLE PRECISION CHECK (frame_rate IS NULL OR frame_rate > 0),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','ready','failed')),
    progress REAL CHECK (progress IS NULL OR progress BETWEEN 0 AND 1),
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (screen_group_id, screen_id, source_asset_id, source_variant_id, geometry_hash)
);
CREATE INDEX span_video_panels_group_idx ON span_video_panels(screen_group_id, status, updated_at DESC);
CREATE INDEX span_video_panels_source_idx ON span_video_panels(source_asset_id, source_variant_id);

ALTER TABLE media_jobs
    ADD COLUMN payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_kind_check;
ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_kind_check CHECK (kind IN (
    'inspect_asset','generate_image_thumbnail','generate_video_poster','optimize_video',
    'delete_asset_files','clean_expired_uploads','generate_span_video_panel'
));

-- +goose Down

DELETE FROM media_jobs WHERE kind='generate_span_video_panel';
ALTER TABLE media_jobs DROP CONSTRAINT media_jobs_kind_check;
ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_kind_check CHECK (kind IN (
    'inspect_asset','generate_image_thumbnail','generate_video_poster','optimize_video',
    'delete_asset_files','clean_expired_uploads'
));
ALTER TABLE media_jobs DROP COLUMN payload;
DROP INDEX span_video_panels_source_idx;
DROP INDEX span_video_panels_group_idx;
DROP TABLE span_video_panels;
DROP INDEX screen_group_panels_screen_idx;
DROP TABLE screen_group_panels;
ALTER TABLE screen_groups
    DROP CONSTRAINT screen_groups_span_revision_check,
    DROP CONSTRAINT screen_groups_span_canvas_check,
    DROP COLUMN span_geometry_revision,
    DROP COLUMN span_canvas_height,
    DROP COLUMN span_canvas_width;
