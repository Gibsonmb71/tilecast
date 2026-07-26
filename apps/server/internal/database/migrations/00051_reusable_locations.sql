-- +goose Up
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organization_settings(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120 AND name = btrim(name)),
    address_line_1 TEXT NOT NULL DEFAULT '' CHECK (char_length(address_line_1) <= 240),
    address_line_2 TEXT NOT NULL DEFAULT '' CHECK (char_length(address_line_2) <= 240),
    city TEXT NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
    state TEXT NOT NULL DEFAULT '' CHECK (char_length(state) <= 120),
    postal_code TEXT NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 40),
    country TEXT NOT NULL DEFAULT '' CHECK (char_length(country) <= 120),
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX locations_organization_normalized_name_unique
    ON locations (organization_id, lower(name));
CREATE INDEX locations_organization_name_idx
    ON locations (organization_id, lower(name));

INSERT INTO locations (organization_id, name)
SELECT organization_id, name
FROM (
    SELECT organization_id,
           btrim(location) AS name,
           row_number() OVER (
               PARTITION BY organization_id, lower(btrim(location))
               ORDER BY created_at, id
           ) AS duplicate_number
    FROM screens
    WHERE btrim(location) <> ''
) normalized
WHERE duplicate_number = 1;

ALTER TABLE screens
    ADD COLUMN location_id UUID REFERENCES locations(id) ON DELETE RESTRICT,
    ADD COLUMN room_name TEXT NOT NULL DEFAULT '' CHECK (char_length(room_name) <= 120),
    ADD COLUMN room_number TEXT NOT NULL DEFAULT '' CHECK (char_length(room_number) <= 80);

UPDATE screens screen
SET location_id = location.id
FROM locations location
WHERE location.organization_id = screen.organization_id
  AND lower(location.name) = lower(btrim(screen.location))
  AND btrim(screen.location) <> '';

CREATE INDEX screens_location_id_idx ON screens(location_id);
ALTER TABLE screens DROP COLUMN location;

-- +goose Down
ALTER TABLE screens ADD COLUMN location TEXT NOT NULL DEFAULT '';
UPDATE screens screen
SET location = location.name
FROM locations location
WHERE location.id = screen.location_id;
DROP INDEX screens_location_id_idx;
ALTER TABLE screens
    DROP COLUMN room_number,
    DROP COLUMN room_name,
    DROP COLUMN location_id;
DROP TABLE locations;
