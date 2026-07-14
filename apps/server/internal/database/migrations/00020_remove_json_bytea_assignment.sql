-- +goose Up

-- JSON documents are passed as UTF-8 text and explicitly cast at each SQL
-- boundary. A database-wide bytea assignment cast makes arbitrary binary data
-- eligible for JSON coercion and hides incorrect parameter encoding.
DROP CAST IF EXISTS (bytea AS jsonb);
DROP FUNCTION IF EXISTS tilecast_bytea_to_jsonb(bytea);

-- +goose Down

CREATE FUNCTION tilecast_bytea_to_jsonb(value bytea)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS 'SELECT convert_from($1, ''UTF8'')::jsonb';

CREATE CAST (bytea AS jsonb)
    WITH FUNCTION tilecast_bytea_to_jsonb(bytea)
    AS ASSIGNMENT;
