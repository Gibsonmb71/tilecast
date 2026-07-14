-- +goose Up

-- QueryExecModeExec sends []byte values to PostgreSQL as bytea. Tilecast uses
-- []byte for already-encoded JSON payloads, manifests, and provider responses,
-- so allow those values to be assigned to jsonb columns without turning the
-- bytes into PostgreSQL's \x... bytea text representation.
CREATE OR REPLACE FUNCTION tilecast_bytea_to_jsonb(value bytea)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS 'SELECT convert_from($1, ''UTF8'')::jsonb';

DROP CAST IF EXISTS (bytea AS jsonb);
CREATE CAST (bytea AS jsonb)
    WITH FUNCTION tilecast_bytea_to_jsonb(bytea)
    AS ASSIGNMENT;

-- +goose Down

DROP CAST IF EXISTS (bytea AS jsonb);
DROP FUNCTION IF EXISTS tilecast_bytea_to_jsonb(bytea);
