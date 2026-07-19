-- +goose Up
CREATE TABLE backup_archives (
    id UUID PRIMARY KEY,
    file_name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('manual', 'scheduled', 'pre_restore', 'imported')),
    status TEXT NOT NULL CHECK (status IN ('complete', 'missing', 'unrecognized')),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    archive_sha256 TEXT NOT NULL DEFAULT '',
    tilecast_version TEXT NOT NULL DEFAULT '',
    schema_version BIGINT NOT NULL DEFAULT 0,
    installation_id TEXT NOT NULL DEFAULT '',
    organization_name TEXT NOT NULL DEFAULT '',
    components JSONB NOT NULL DEFAULT '[]'::jsonb,
    verification TEXT NOT NULL DEFAULT 'unverified' CHECK (verification IN ('unverified', 'verified', 'failed')),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE backup_jobs (
    id UUID PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('backup', 'verify', 'restore')),
    trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'pre_restore', 'cli')),
    archive_id UUID REFERENCES backup_archives (id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    phase TEXT NOT NULL DEFAULT '',
    progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    confirm_identity_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    requested_by UUID,
    locked_at TIMESTAMPTZ,
    locked_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- Only one backup, verify, or restore job may be queued or running at a time.
CREATE UNIQUE INDEX backup_jobs_single_active ON backup_jobs ((TRUE)) WHERE status IN ('queued', 'running');
CREATE INDEX backup_jobs_claim_idx ON backup_jobs (status, created_at);

CREATE TABLE backup_schedule_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE backup_schedule_state;
DROP TABLE backup_jobs;
DROP TABLE backup_archives;
