import type { SettingDefinition } from "../api/types";
import { dependencyState } from "./settingDependencies";
import { descriptionFor, groupsFor } from "./settingDisplay";
import type { SettingsSectionId } from "./settingsNavigation";
import { SettingControl } from "./SettingControl";

export function SettingsSection({
  section,
  definitions,
  values,
  editable,
  onChange,
  before,
}: {
  section: SettingsSectionId;
  definitions: SettingDefinition[];
  values: Record<string, unknown>;
  editable: boolean;
  onChange: (key: string, value: unknown) => void;
  before?: React.ReactNode;
}) {
  return (
    <div className="settings-sections">
      {before}
      {groupsFor(section, definitions).map((group) => (
        <section className="settings-subsection" key={group.title}>
          <header>
            <h3>{group.title}</h3>
            {group.description && <p>{group.description}</p>}
          </header>
          {group.definitions.map((definition) => {
            const dependency = dependencyState(definition.key, values);
            const disabled = !editable || dependency.disabled;
            return (
              <div
                className={`setting-row${disabled ? " setting-row--disabled" : ""}`}
                key={definition.key}
              >
                <div className="setting-copy">
                  <label>{definition.title}</label>
                  <p>{descriptionFor(definition)}</p>
                  {definition.futureOnly && (
                    <span className="setting-note">
                      Applies to future processing only
                    </span>
                  )}
                  {dependency.disabled && (
                    <span className="setting-dependency">
                      {dependency.message}
                    </span>
                  )}
                </div>
                <div className="setting-control">
                  <SettingControl
                    definition={definition}
                    value={values[definition.key] ?? definition.default}
                    disabled={disabled}
                    onChange={(value) => onChange(definition.key, value)}
                  />
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
