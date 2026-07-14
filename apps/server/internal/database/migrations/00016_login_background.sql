-- +goose Up
CREATE TABLE organization_login_branding (
    organization_id UUID PRIMARY KEY REFERENCES organization_settings(id) ON DELETE CASCADE,
    background_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organization_login_branding (organization_id)
SELECT id FROM organization_settings
ON CONFLICT (organization_id) DO NOTHING;

-- +goose Down
DROP TABLE organization_login_branding;
