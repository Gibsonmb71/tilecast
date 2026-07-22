-- +goose Up
ALTER TABLE layouts
    ADD COLUMN preview_image BYTEA,
    ADD COLUMN preview_content_type TEXT,
    ADD COLUMN preview_width INTEGER,
    ADD COLUMN preview_height INTEGER,
    ADD COLUMN preview_updated_at TIMESTAMPTZ,
    ADD CONSTRAINT layouts_preview_image_size CHECK (preview_image IS NULL OR octet_length(preview_image) BETWEEN 1 AND 512000),
    ADD CONSTRAINT layouts_preview_image_shape CHECK (
        (preview_image IS NULL AND preview_content_type IS NULL AND preview_width IS NULL AND preview_height IS NULL AND preview_updated_at IS NULL)
        OR
        (preview_image IS NOT NULL AND preview_content_type = 'image/jpeg' AND preview_width BETWEEN 1 AND 960 AND preview_height BETWEEN 1 AND 960 AND preview_updated_at IS NOT NULL)
    );

-- +goose Down
ALTER TABLE layouts
    DROP CONSTRAINT layouts_preview_image_shape,
    DROP CONSTRAINT layouts_preview_image_size,
    DROP COLUMN preview_updated_at,
    DROP COLUMN preview_height,
    DROP COLUMN preview_width,
    DROP COLUMN preview_content_type,
    DROP COLUMN preview_image;
