-- +goose Up
ALTER TABLE screen_playlist_assignments
    ALTER COLUMN playlist_id DROP NOT NULL,
    ADD COLUMN layout_id UUID REFERENCES layouts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT screen_assignment_presentation_check CHECK ((playlist_id IS NULL) <> (layout_id IS NULL));
CREATE INDEX screen_playlist_assignments_layout_idx ON screen_playlist_assignments(layout_id) WHERE layout_id IS NOT NULL;

ALTER TABLE screen_group_playlist_assignments
    ALTER COLUMN playlist_id DROP NOT NULL,
    ADD COLUMN layout_id UUID REFERENCES layouts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT screen_group_assignment_presentation_check CHECK ((playlist_id IS NULL) <> (layout_id IS NULL));
CREATE INDEX screen_group_playlist_assignments_layout_idx ON screen_group_playlist_assignments(layout_id) WHERE layout_id IS NOT NULL;

ALTER TABLE schedules
    ALTER COLUMN playlist_id DROP NOT NULL,
    ADD COLUMN layout_id UUID REFERENCES layouts(id) ON DELETE RESTRICT,
    ADD CONSTRAINT schedule_presentation_check CHECK ((playlist_id IS NULL) <> (layout_id IS NULL));
CREATE INDEX schedules_layout_idx ON schedules(layout_id) WHERE deleted_at IS NULL AND layout_id IS NOT NULL;

-- +goose Down
DELETE FROM schedules WHERE layout_id IS NOT NULL;
DELETE FROM screen_group_playlist_assignments WHERE layout_id IS NOT NULL;
DELETE FROM screen_playlist_assignments WHERE layout_id IS NOT NULL;
ALTER TABLE schedules DROP CONSTRAINT schedule_presentation_check, DROP COLUMN layout_id, ALTER COLUMN playlist_id SET NOT NULL;
ALTER TABLE screen_group_playlist_assignments DROP CONSTRAINT screen_group_assignment_presentation_check, DROP COLUMN layout_id, ALTER COLUMN playlist_id SET NOT NULL;
ALTER TABLE screen_playlist_assignments DROP CONSTRAINT screen_assignment_presentation_check, DROP COLUMN layout_id, ALTER COLUMN playlist_id SET NOT NULL;
