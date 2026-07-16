-- +goose Up
ALTER TABLE screen_player_status
    ADD COLUMN presentation_schema_versions integer[] NOT NULL DEFAULT '{}',
    ADD COLUMN native_presentation_capabilities jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN web_runtime_version integer NOT NULL DEFAULT 0,
    ADD COLUMN web_bundle_limit_bytes bigint NOT NULL DEFAULT 0;

CREATE TABLE presentation_catalog_state (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    revision bigint NOT NULL DEFAULT 1,
    compiler_fingerprint text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO presentation_catalog_state(singleton) VALUES(true);

-- +goose Down
DROP TABLE presentation_catalog_state;
ALTER TABLE screen_player_status
    DROP COLUMN web_bundle_limit_bytes,
    DROP COLUMN web_runtime_version,
    DROP COLUMN native_presentation_capabilities,
    DROP COLUMN presentation_schema_versions;
