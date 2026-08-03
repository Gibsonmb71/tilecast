-- +goose Up

-- Playlist authoring is deliberately separate from the normalized rows used by
-- manifest assembly.  Those rows remain the published runtime representation;
-- these rows are the mutable working copy.
CREATE TABLE playlist_drafts (
    playlist_id UUID PRIMARY KEY REFERENCES playlists(id) ON DELETE CASCADE,
    revision BIGINT NOT NULL CHECK (revision > 0),
    published_draft_revision BIGINT NOT NULL DEFAULT 1 CHECK (published_draft_revision > 0),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'static' CHECK (source_type IN ('static','tag')),
    tag_match TEXT NOT NULL DEFAULT 'any' CHECK (tag_match IN ('any','all')),
    tag_image_duration_ms BIGINT NOT NULL DEFAULT 10000 CHECK (tag_image_duration_ms BETWEEN 1000 AND 86400000),
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE playlist_draft_items (
    id UUID PRIMARY KEY,
    playlist_id UUID NOT NULL REFERENCES playlist_drafts(playlist_id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE RESTRICT,
    layout_id UUID REFERENCES layouts(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position >= 0),
    duration_ms BIGINT CHECK (duration_ms IS NULL OR duration_ms > 0),
    fit_mode TEXT NOT NULL DEFAULT 'contain' CHECK (fit_mode IN ('contain','cover','stretch')),
    transition TEXT NOT NULL DEFAULT 'none' CHECK (transition IN ('none','fade','crossfade')),
    audio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    volume REAL NOT NULL DEFAULT 1 CHECK (volume BETWEEN 0 AND 1),
    video_start_offset_ms BIGINT CHECK (video_start_offset_ms IS NULL OR video_start_offset_ms >= 0),
    video_end_offset_ms BIGINT CHECK (video_end_offset_ms IS NULL OR video_end_offset_ms > 0),
    delivery_policy TEXT NOT NULL DEFAULT 'download' CHECK (delivery_policy IN ('download','stream','automatic')),
    use_player_defaults BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (playlist_id, position),
    CHECK ((asset_id IS NULL) <> (layout_id IS NULL))
);
CREATE INDEX playlist_draft_items_asset_idx ON playlist_draft_items(asset_id);
CREATE INDEX playlist_draft_items_layout_idx ON playlist_draft_items(layout_id) WHERE layout_id IS NOT NULL;

CREATE TABLE playlist_draft_tags (
    playlist_id UUID NOT NULL REFERENCES playlist_drafts(playlist_id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES content_tags(id) ON DELETE RESTRICT,
    PRIMARY KEY (playlist_id, tag_id)
);

-- A submission is the exact immutable object a reviewer saw.  The snapshot is
-- retained even when the author continues editing the working draft.
CREATE TABLE content_submissions (
    id UUID PRIMARY KEY,
    content_type TEXT NOT NULL CHECK (content_type IN ('playlist','layout','campaign')),
    content_id UUID NOT NULL,
    working_revision BIGINT NOT NULL CHECK (working_revision > 0),
    snapshot JSONB NOT NULL,
    snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    based_published_revision BIGINT,
    based_published_revision_id UUID,
    status TEXT NOT NULL CHECK (status IN ('in_review','changes_requested','approved','scheduled','published','superseded','cancelled','publication_failed')),
    review_required BOOLEAN NOT NULL DEFAULT TRUE,
    allow_self_approval BOOLEAN NOT NULL DEFAULT TRUE,
    review_note TEXT NOT NULL DEFAULT '',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    requested_publication_at TIMESTAMPTZ,
    publication_failure_reason TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX content_submissions_queue_idx ON content_submissions(status, submitted_at DESC);
CREATE INDEX content_submissions_content_idx ON content_submissions(content_type, content_id, submitted_at DESC);
CREATE UNIQUE INDEX content_submissions_active_content_idx
    ON content_submissions(content_type, content_id)
    WHERE status IN ('in_review','approved','scheduled');

CREATE TABLE publication_history (
    id UUID PRIMARY KEY,
    content_type TEXT NOT NULL CHECK (content_type IN ('playlist','layout','campaign')),
    content_id UUID NOT NULL,
    content_revision BIGINT NOT NULL CHECK (content_revision > 0),
    native_revision_id UUID,
    submission_id UUID REFERENCES content_submissions(id) ON DELETE SET NULL,
    campaign_release_id UUID,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    supersedes_publication_id UUID REFERENCES publication_history(id) ON DELETE SET NULL,
    method TEXT NOT NULL CHECK (method IN ('manual','automatic_after_approval','scheduled','rollback','migration','backfill')),
    affected_screen_count INTEGER NOT NULL DEFAULT 0 CHECK (affected_screen_count >= 0),
    snapshot_sha256 TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX publication_history_content_idx ON publication_history(content_type, content_id, published_at DESC);
CREATE INDEX publication_history_native_revision_idx ON publication_history(native_revision_id) WHERE native_revision_id IS NOT NULL;

-- Campaigns are scheduling containers.  Their draft is mutable; releases are
-- immutable deployment snapshots and are materialized into ordinary schedules.
CREATE TABLE campaigns (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    campaign_start TIMESTAMPTZ,
    campaign_end TIMESTAMPTZ,
    destinations JSONB NOT NULL DEFAULT '[]'::jsonb,
    draft JSONB NOT NULL DEFAULT '{}'::jsonb,
    draft_revision BIGINT NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
    archived_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_library_idx ON campaigns(organization_id, updated_at DESC, id) WHERE archived_at IS NULL;

CREATE TABLE campaign_releases (
    id UUID PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
    release_number BIGINT NOT NULL CHECK (release_number > 0),
    submission_id UUID UNIQUE REFERENCES content_submissions(id) ON DELETE SET NULL,
    snapshot JSONB NOT NULL,
    snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL CHECK (status IN ('in_review','changes_requested','approved','scheduled','published','superseded','cancelled','publication_failed')),
    based_release_id UUID REFERENCES campaign_releases(id) ON DELETE SET NULL,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    published_at TIMESTAMPTZ,
    requested_publication_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(campaign_id, release_number)
);
CREATE INDEX campaign_releases_history_idx ON campaign_releases(campaign_id, release_number DESC);
ALTER TABLE publication_history
    ADD CONSTRAINT publication_history_campaign_release_fk
    FOREIGN KEY (campaign_release_id) REFERENCES campaign_releases(id) ON DELETE SET NULL;

ALTER TABLE schedules
    ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE RESTRICT,
    ADD COLUMN campaign_release_id UUID REFERENCES campaign_releases(id) ON DELETE RESTRICT,
    ADD COLUMN campaign_block_id UUID;
ALTER TABLE schedules ADD CONSTRAINT schedule_campaign_link_check
    CHECK ((campaign_id IS NULL AND campaign_release_id IS NULL AND campaign_block_id IS NULL)
        OR (campaign_id IS NOT NULL AND campaign_release_id IS NOT NULL AND campaign_block_id IS NOT NULL));
CREATE INDEX schedules_campaign_idx ON schedules(campaign_id, campaign_release_id) WHERE deleted_at IS NULL AND campaign_id IS NOT NULL;

-- Seed an isolated playlist draft from the currently-live normalized rows.
INSERT INTO playlist_drafts(playlist_id,revision,published_draft_revision,name,description,source_type,tag_match,tag_image_duration_ms,updated_by,updated_at)
SELECT id,revision,revision,name,description,source_type,tag_match,tag_image_duration_ms,created_by,updated_at
FROM playlists
WHERE deleted_at IS NULL
ON CONFLICT (playlist_id) DO NOTHING;
INSERT INTO playlist_draft_items(id,playlist_id,asset_id,layout_id,position,duration_ms,fit_mode,transition,audio_enabled,volume,video_start_offset_ms,video_end_offset_ms,delivery_policy,use_player_defaults,created_at,updated_at)
SELECT i.id,d.playlist_id,i.asset_id,i.layout_id,i.position,i.duration_ms,i.fit_mode,i.transition,i.audio_enabled,i.volume,i.video_start_offset_ms,i.video_end_offset_ms,i.delivery_policy,i.use_player_defaults,i.created_at,i.updated_at
FROM playlist_items i JOIN playlist_drafts d ON d.playlist_id=i.playlist_id
ON CONFLICT (id) DO NOTHING;
INSERT INTO playlist_draft_tags(playlist_id,tag_id)
SELECT pt.playlist_id,pt.tag_id FROM playlist_tags pt JOIN playlist_drafts d ON d.playlist_id=pt.playlist_id
ON CONFLICT DO NOTHING;

-- Preserve current live playlist snapshots where the older history feature did
-- not capture one yet.  This does not touch runtime rows or manifest state.
INSERT INTO playlist_revisions(id,playlist_id,revision,name,description,source_type,tag_match,tag_image_duration_ms,items,tag_ids,created_by,created_at)
SELECT gen_random_uuid(),p.id,p.revision,p.name,p.description,p.source_type,p.tag_match,p.tag_image_duration_ms,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId',i.asset_id,'layoutId',i.layout_id,'position',i.position,'durationMs',i.duration_ms,'fitMode',i.fit_mode,'transition',i.transition,'audioEnabled',i.audio_enabled,'volume',i.volume,'usePlayerDefaults',i.use_player_defaults,'videoStartOffsetMs',i.video_start_offset_ms,'videoEndOffsetMs',i.video_end_offset_ms,'deliveryPolicy',i.delivery_policy) ORDER BY i.position) FROM playlist_items i WHERE i.playlist_id=p.id),'[]'::jsonb),
       COALESCE((SELECT jsonb_agg(pt.tag_id) FROM playlist_tags pt WHERE pt.playlist_id=p.id),'[]'::jsonb),p.created_by,p.updated_at
FROM playlists p WHERE p.deleted_at IS NULL
ON CONFLICT (playlist_id,revision) DO NOTHING;

-- Existing Layout revisions are already immutable publications.  Existing
-- playlist snapshots represent the live edits retained by the old system.
INSERT INTO publication_history(id,content_type,content_id,content_revision,native_revision_id,published_by,published_at,method,affected_screen_count)
SELECT gen_random_uuid(),'layout',r.layout_id,r.revision,r.id,r.published_by,r.published_at,'migration',
       (SELECT count(*) FROM screen_playlist_assignments a WHERE a.layout_id=r.layout_id)
FROM layout_revisions r;
INSERT INTO publication_history(id,content_type,content_id,content_revision,native_revision_id,published_by,published_at,method,affected_screen_count)
SELECT gen_random_uuid(),'playlist',r.playlist_id,r.revision,r.id,r.created_by,r.created_at,'migration',
       (SELECT count(*) FROM screen_playlist_assignments a WHERE a.playlist_id=r.playlist_id)
FROM playlist_revisions r;

-- Translate the old boolean policy without weakening installations that had it
-- enabled.  The old key remains readable for rollback/compatibility.
UPDATE organization_runtime_settings
SET settings = settings || jsonb_build_object(
    'content.review_policy', CASE WHEN settings->>'content.approval_required' = 'true' THEN 'everyone' ELSE 'off' END,
    'content.allow_self_approval', TRUE,
    'content.auto_publish_on_approval', FALSE
);

-- +goose Down

ALTER TABLE schedules DROP CONSTRAINT schedule_campaign_link_check;
DROP INDEX schedules_campaign_idx;
ALTER TABLE schedules DROP COLUMN campaign_block_id, DROP COLUMN campaign_release_id, DROP COLUMN campaign_id;
ALTER TABLE publication_history DROP CONSTRAINT publication_history_campaign_release_fk;
DROP TABLE campaign_releases;
DROP TABLE campaigns;
DROP TABLE publication_history;
DROP INDEX content_submissions_active_content_idx;
DROP INDEX content_submissions_content_idx;
DROP INDEX content_submissions_queue_idx;
DROP TABLE content_submissions;
DROP INDEX playlist_draft_items_layout_idx;
DROP INDEX playlist_draft_items_asset_idx;
DROP TABLE playlist_draft_tags;
DROP TABLE playlist_draft_items;
DROP TABLE playlist_drafts;
