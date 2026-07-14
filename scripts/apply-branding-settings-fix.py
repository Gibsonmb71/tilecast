from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


replace(
    "apps/dashboard/src/settings/SettingsSection.tsx",
    '''                  <details>\n                    <summary>Advanced details</summary>\n                    <code>{definition.key}</code>\n                  </details>\n''',
    "",
)

replace(
    "apps/dashboard/src/pages/SettingsPage.tsx",
    'import { SettingsActionBar } from "../settings/SettingsActionBar";\n',
    'import { SettingsActionBar } from "../settings/SettingsActionBar";\nimport { BrandingAssets } from "../settings/BrandingAssets";\n',
)

replace(
    "apps/dashboard/src/pages/SettingsPage.tsx",
    '  let before: React.ReactNode;\n  if (active === "branding") before = <BrandingPreview values={values} />;\n',
    '''  let before: React.ReactNode;\n  if (active === "branding")\n    before = (\n      <>\n        <BrandingAssets\n          values={values}\n          editable={manageable}\n          onChange={onChange}\n        />\n        <BrandingPreview values={values} />\n      </>\n    );\n''',
)

replace(
    "apps/dashboard/src/pages/SettingsPage.tsx",
    '''  return (\n    <SettingsSection\n      section={active}\n      definitions={definitions}\n''',
    '''  const visibleDefinitions =\n    active === "branding"\n      ? definitions.filter(\n          (definition) =>\n            ![\n              "branding.logo_asset_id",\n              "branding.icon_asset_id",\n              "branding.primary_color",\n              "branding.player_background_color",\n              "branding.player_text_color",\n            ].includes(definition.key),\n        )\n      : definitions;\n  return (\n    <SettingsSection\n      section={active}\n      definitions={visibleDefinitions}\n''',
)

replace(
    "apps/dashboard/src/pages/SettingsPage.tsx",
    '''            background: text(\n              values["branding.player_background_color"],\n              signalColors.playerBackground,\n            ),\n            color: text(\n              values["branding.player_text_color"],\n              signalColors.playerText,\n            ),\n''',
    '''            background: signalColors.playerBackground,\n            color: signalColors.playerText,\n''',
)

replace(
    "apps/dashboard/src/settings/settingDisplay.ts",
    '''  "branding.logo_asset_id":\n    "Advanced: enter the UUID of a ready image asset used as the organization logo.",\n  "branding.icon_asset_id":\n    "Advanced: enter the UUID of a ready square image asset.",\n''',
    "",
)

replace(
    "apps/dashboard/src/settings/settingDisplay.ts",
    '''  branding: [\n    {\n      title: "Organization identity",\n      keys: [\n        "branding.logo_asset_id",\n        "branding.icon_asset_id",\n        "branding.primary_color",\n      ],\n    },\n    {\n      title: "Player appearance",\n      keys: ["branding.player_background_color", "branding.player_text_color"],\n    },\n    {\n''',
    '''  branding: [\n    {\n''',
)
