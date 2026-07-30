-- +goose Up

-- Outbound notification delivery. Incidents already model an operational
-- condition well: they open once, absorb repeats, and recover. What was
-- missing is anyone finding out unless they had Studio open. For a school
-- where the signage owner teaches all day, that is the difference between
-- "self-hosted signage" and "signage that stays on".
--
-- Delivery is an outbox rather than a call-site hook. Incidents are opened
-- from two unrelated paths -- event derivation inside the ingest transaction,
-- and the offline sweep, which runs from current state and sends no event --
-- so a hook would have to be installed twice and would still miss the next
-- path added. A worker that reads state transitions covers all of them and
-- cannot notify for a transaction that rolled back.

-- Marks the transition as notified, not the incident as read. Two columns
-- rather than one status because an incident notifies at most twice: once
-- when it opens and once when it recovers. A repeat deliberately sends
-- nothing -- the incident model exists precisely so a screen flapping ten
-- times is one problem, and the notifier inherits that or it becomes the
-- alert storm the incident table was built to prevent.
ALTER TABLE incidents
    ADD COLUMN notified_open_at timestamptz,
    ADD COLUMN notified_recovered_at timestamptz;

-- Existing history is not news. Without this backfill the first worker tick
-- after an upgrade would mail out every incident the installation has ever
-- recorded, which is exactly the alert storm this feature exists to avoid.
UPDATE incidents
SET notified_open_at = now(),
    notified_recovered_at = CASE WHEN recovered_at IS NOT NULL THEN now() END;

-- Finding the untouched transitions must stay cheap: the worker runs this
-- every tick and the table grows for the life of the installation.
CREATE INDEX incidents_pending_open_notification_idx
    ON incidents(opened_at)
    WHERE notified_open_at IS NULL;
CREATE INDEX incidents_pending_recovery_notification_idx
    ON incidents(recovered_at)
    WHERE recovered_at IS NOT NULL AND notified_recovered_at IS NULL;

CREATE TABLE notification_webhooks (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organization_settings(id),
    name text NOT NULL,
    url text NOT NULL,
    -- Recoverable, unlike every other secret in this schema. An HMAC signing
    -- key has to be presented to the receiver on each request, so it cannot be
    -- stored as a hash the way a device credential or a recovery code is. It
    -- is the second recoverable secret here after TOTP, and carries the same
    -- rules: never logged, never in audit metadata, never returned by the API
    -- after creation, and included in a backup with the same sensitivity as
    -- the rest of the database. It grants nothing in Tilecast; it only lets a
    -- receiver prove a request came from this installation.
    signing_secret text NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    -- Empty means every category. Stored rather than derived so a webhook
    -- pointed at a chat relay can carry incidents without backup chatter.
    categories text[] NOT NULL DEFAULT '{}',
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    last_error text NOT NULL DEFAULT '',
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);
CREATE INDEX notification_webhooks_active_idx
    ON notification_webhooks(created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE notification_deliveries (
    id uuid PRIMARY KEY,
    -- Identifies the transition, not the send: "incident <id> opened". The
    -- unique constraint below is what makes the outbox safe to re-scan -- a
    -- worker that crashes between enqueue and marking the incident notified
    -- re-enqueues nothing.
    event_key text NOT NULL,
    category text NOT NULL CHECK (category IN ('incident', 'content_health', 'backup', 'update')),
    severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    channel text NOT NULL CHECK (channel IN ('email', 'webhook')),
    -- Email address or webhook id. Kept denormalised so a delivery record
    -- survives the user or webhook being removed: the log is evidence of what
    -- Tilecast tried to send, and it must not rewrite itself.
    target text NOT NULL,
    subject text NOT NULL DEFAULT '',
    body text NOT NULL DEFAULT '',
    payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- Also the digest mechanism: a digest subscriber's rows are enqueued with
    -- next_attempt_at set to the next digest time, and everything due for one
    -- address is sent as one message. Quiet hours use the same field.
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    UNIQUE (event_key, channel, target)
);
CREATE INDEX notification_deliveries_due_idx
    ON notification_deliveries(next_attempt_at, target)
    WHERE status = 'pending';
CREATE INDEX notification_deliveries_log_idx
    ON notification_deliveries(created_at DESC, id DESC);

-- +goose Down

DROP TABLE notification_deliveries;
DROP TABLE notification_webhooks;
DROP INDEX incidents_pending_recovery_notification_idx;
DROP INDEX incidents_pending_open_notification_idx;
ALTER TABLE incidents
    DROP COLUMN notified_recovered_at,
    DROP COLUMN notified_open_at;
