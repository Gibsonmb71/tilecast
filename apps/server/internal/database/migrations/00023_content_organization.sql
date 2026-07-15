-- +goose Up
CREATE TABLE content_folders (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    parent_id UUID REFERENCES content_folders(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX content_folders_name_unique ON content_folders(organization_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX content_folders_parent_idx ON content_folders(organization_id, parent_id, lower(name), id);

ALTER TABLE assets ADD COLUMN folder_id UUID REFERENCES content_folders(id) ON DELETE SET NULL;
CREATE INDEX assets_folder_idx ON assets(organization_id, folder_id, updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE content_collections (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX content_collections_name_unique ON content_collections(organization_id, lower(name));
CREATE INDEX content_collections_list_idx ON content_collections(organization_id, lower(name), id);

CREATE TABLE content_collection_assets (
    collection_id UUID NOT NULL REFERENCES content_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (collection_id, asset_id)
);
CREATE INDEX content_collection_assets_asset_idx ON content_collection_assets(asset_id, collection_id);

CREATE TABLE content_tags (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    color TEXT NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX content_tags_name_unique ON content_tags(organization_id, lower(name));
CREATE INDEX content_tags_list_idx ON content_tags(organization_id, lower(name), id);

CREATE TABLE content_asset_tags (
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX content_asset_tags_tag_idx ON content_asset_tags(tag_id, asset_id);

-- +goose Down
DROP TABLE IF EXISTS content_asset_tags;
DROP TABLE IF EXISTS content_tags;
DROP TABLE IF EXISTS content_collection_assets;
DROP TABLE IF EXISTS content_collections;
DROP INDEX IF EXISTS assets_folder_idx;
ALTER TABLE assets DROP COLUMN IF EXISTS folder_id;
DROP TABLE IF EXISTS content_folders;
