-- +goose Up
CREATE TABLE screen_previews (
    screen_id UUID PRIMARY KEY REFERENCES screens(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE CASCADE,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    capture_requested_at TIMESTAMPTZ NOT NULL,
    attempted_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ,
    player_version TEXT NOT NULL DEFAULT '',
    width INTEGER NOT NULL DEFAULT 0 CHECK (width >= 0),
    height INTEGER NOT NULL DEFAULT 0 CHECK (height >= 0),
    file_size INTEGER NOT NULL DEFAULT 0 CHECK (file_size >= 0),
    content_type TEXT NOT NULL DEFAULT '',
    image_data BYTEA,
    failure_status TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX screen_previews_lease_expires_at_idx ON screen_previews(lease_expires_at);

-- +goose Down
DROP TABLE screen_previews;
