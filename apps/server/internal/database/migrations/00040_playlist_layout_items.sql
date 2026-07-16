-- +goose Up
ALTER TABLE playlist_items
    ALTER COLUMN asset_id DROP NOT NULL,
    ADD COLUMN layout_id UUID REFERENCES layouts(id) ON DELETE RESTRICT;

ALTER TABLE playlist_items
    ADD CONSTRAINT playlist_item_content_check
    CHECK ((asset_id IS NULL) <> (layout_id IS NULL));

CREATE INDEX playlist_items_layout_idx ON playlist_items(layout_id) WHERE layout_id IS NOT NULL;

-- +goose Down
DROP INDEX playlist_items_layout_idx;
ALTER TABLE playlist_items DROP CONSTRAINT playlist_item_content_check;
DELETE FROM playlist_items WHERE layout_id IS NOT NULL;
ALTER TABLE playlist_items DROP COLUMN layout_id;
ALTER TABLE playlist_items ALTER COLUMN asset_id SET NOT NULL;
