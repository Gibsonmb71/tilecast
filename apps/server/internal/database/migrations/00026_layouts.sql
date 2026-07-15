-- +goose Up
CREATE TABLE layouts (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    orientation TEXT NOT NULL CHECK (orientation IN ('landscape','portrait','custom')),
    canvas_width INTEGER NOT NULL CHECK (canvas_width BETWEEN 320 AND 7680),
    canvas_height INTEGER NOT NULL CHECK (canvas_height BETWEEN 320 AND 7680),
    draft_document JSONB NOT NULL,
    draft_revision BIGINT NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
    published_revision_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX layouts_library_idx ON layouts(organization_id, updated_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE layout_revisions (
    id UUID PRIMARY KEY,
    layout_id UUID NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision > 0),
    document JSONB NOT NULL,
    document_sha256 TEXT NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(layout_id, revision)
);
CREATE INDEX layout_revisions_history_idx ON layout_revisions(layout_id, revision DESC);
ALTER TABLE layouts ADD CONSTRAINT layouts_published_revision_fk
    FOREIGN KEY (published_revision_id) REFERENCES layout_revisions(id) ON DELETE RESTRICT;

CREATE TABLE layout_draft_dependencies (
    layout_id UUID NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('app','asset','playlist')),
    dependency_id UUID NOT NULL,
    PRIMARY KEY(layout_id, dependency_type, dependency_id)
);
CREATE INDEX layout_draft_dependencies_target_idx ON layout_draft_dependencies(dependency_type, dependency_id);

CREATE TABLE layout_revision_dependencies (
    revision_id UUID NOT NULL REFERENCES layout_revisions(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL CHECK (dependency_type IN ('app','asset','playlist')),
    dependency_id UUID NOT NULL,
    PRIMARY KEY(revision_id, dependency_type, dependency_id)
);
CREATE INDEX layout_revision_dependencies_target_idx ON layout_revision_dependencies(dependency_type, dependency_id);

-- +goose Down
ALTER TABLE layouts DROP CONSTRAINT layouts_published_revision_fk;
DROP TABLE layout_revision_dependencies;
DROP TABLE layout_draft_dependencies;
DROP TABLE layout_revisions;
DROP TABLE layouts;
