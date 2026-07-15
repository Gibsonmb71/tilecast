-- +goose Up

ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube','calendar'));

CREATE TABLE source_refresh_states (
    asset_id UUID PRIMARY KEY REFERENCES sources(asset_id) ON DELETE CASCADE,
    next_refresh_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    http_result_category TEXT,
    parse_status TEXT NOT NULL DEFAULT 'not_attempted',
    available_event_count INTEGER NOT NULL DEFAULT 0 CHECK(available_event_count >= 0),
    using_cached_data BOOLEAN NOT NULL DEFAULT FALSE,
    cache_updated_at TIMESTAMPTZ,
    cache_expires_at TIMESTAMPTZ,
    cached_payload JSONB NOT NULL DEFAULT '{"events":[]}'::jsonb
        CHECK(jsonb_typeof(cached_payload) = 'object'),
    error_code TEXT,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX source_refresh_states_claim_idx
    ON source_refresh_states(next_refresh_at, asset_id)
    WHERE locked_at IS NULL;

-- +goose Down

DELETE FROM playlist_items
WHERE asset_id IN (SELECT asset_id FROM sources WHERE provider = 'calendar');
DELETE FROM assets
WHERE id IN (SELECT asset_id FROM sources WHERE provider = 'calendar');
DROP TABLE source_refresh_states;
ALTER TABLE sources DROP CONSTRAINT sources_provider_check;
ALTER TABLE sources ADD CONSTRAINT sources_provider_check
    CHECK(provider IN ('website','youtube'));
