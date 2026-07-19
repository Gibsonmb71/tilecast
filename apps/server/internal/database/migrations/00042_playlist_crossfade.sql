-- +goose Up
ALTER TABLE playlist_items DROP CONSTRAINT playlist_items_transition_check;
ALTER TABLE playlist_items ADD CONSTRAINT playlist_items_transition_check CHECK (transition IN ('none', 'fade', 'crossfade'));

-- +goose Down
UPDATE playlist_items SET transition='fade' WHERE transition='crossfade';
ALTER TABLE playlist_items DROP CONSTRAINT playlist_items_transition_check;
ALTER TABLE playlist_items ADD CONSTRAINT playlist_items_transition_check CHECK (transition IN ('none', 'fade'));
