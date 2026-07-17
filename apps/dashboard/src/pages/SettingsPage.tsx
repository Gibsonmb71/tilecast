import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { api, ApiError } from "../api/client";
import type { SettingDefinition } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { signalColors } from "@tilecast/design-tokens/values";
import { SettingsShell } from "../settings/SettingsShell";
import { SettingsSection } from "../settings/SettingsSection";
import { SettingsActionBar } from "../settings/SettingsActionBar";
import { BrandingAssets } from "../settings/BrandingAssets";
import {
  sectionFromPath,
  type SettingsSectionId,
} from "../settings/settingsNavigation";
import {
  ImportExportPanel,
  PlayerUpdatesPanel,
  SystemPanel,
} from "../settings/SettingsOperations";
import { UsersPage } from "./UsersPage";

export { PlayerPolicyEditor } from "../settings/PlayerPolicyEditor";
export {
  canDeployPlayerUpdates,
  playerUpdateStateLabel,
} from "../settings/SettingsOperations";

export function SettingsPage() {
  const auth = useAuth();
  const location = useLocation();
  const active = sectionFromPath(location.pathname);
  const manageable = ["owner", "administrator"].includes(
    auth.status?.user?.role ?? "",
  );
  const owner = auth.status?.user?.role === "owner";
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
  });
  const [baseline, setBaseline] = useState<Record<string, unknown>>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [revision, setRevision] = useState(0);
  const [preferenceBaseline, setPreferenceBaseline] =
    useState<Record<string, unknown>>();
  const [preferenceDraft, setPreferenceDraft] = useState<
    Record<string, unknown>
  >({});
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [saved, setSaved] = useState<string>();
  useEffect(() => {
    if (settings.data && !baseline) {
      setBaseline(settings.data.values);
      setDraft(settings.data.values);
      setRevision(settings.data.revision);
    }
  }, [settings.data, baseline]);
  useEffect(() => {
    if (preferences.data && !preferenceBaseline) {
      setPreferenceBaseline(preferences.data.values);
      setPreferenceDraft(preferences.data.values);
      setPreferenceRevision(preferences.data.revision);
    }
  }, [preferences.data, preferenceBaseline]);
  useEffect(() => applyPreferences(preferenceDraft), [preferenceDraft]);
  const organizationDefinitions = (settings.data?.definitions ?? []).filter(
    (definition) => definition.scope !== "preference",
  );
  const preferenceDefinitions = preferences.data?.definitions ?? [];
  const organizationDirty = useMemo(
    () => dirtySections(organizationDefinitions, baseline ?? {}, draft),
    [organizationDefinitions, baseline, draft],
  );
  const dirty = new Set(organizationDirty);
  if (
    preferenceBaseline &&
    sectionDirty(preferenceDefinitions, preferenceBaseline, preferenceDraft)
  )
    dirty.add("preferences");
  const currentDefinitions =
    active === "preferences"
      ? preferenceDefinitions
      : definitionsFor(active, organizationDefinitions);
  const currentValues = active === "preferences" ? preferenceDraft : draft;
  const currentBaseline =
    active === "preferences" ? preferenceBaseline : baseline;
  const currentDirty = dirty.has(active);
  useNavigationWarning(dirty.size > 0);
  const saveOrganization = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.updateSettings(revision, values, auth.status?.csrfToken ?? ""),
  });
  const savePreferences = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.updatePreferences(
        preferenceRevision,
        values,
        auth.status?.csrfToken ?? "",
      ),
  });
  const save = () => {
    setSaved(undefined);
    if (active === "preferences") {
      savePreferences.mutate(preferenceDraft, {
        onSuccess: (data) => {
          setPreferenceBaseline(data.values);
          setPreferenceDraft(data.values);
          setPreferenceRevision(data.revision);
          setSaved("Preferences saved.");
        },
      });
      return;
    }
    const keys = new Set(
      currentDefinitions.map((definition) => definition.key),
    );
    const payload = { ...(baseline ?? {}) };
    for (const key of keys) payload[key] = draft[key];
    const oldBaseline = baseline ?? {};
    const oldDraft = draft;
    saveOrganization.mutate(payload, {
      onSuccess: (data) => {
        const next = { ...data.values };
        for (const definition of organizationDefinitions) {
          if (
            !keys.has(definition.key) &&
            !same(oldDraft[definition.key], oldBaseline[definition.key])
          )
            next[definition.key] = oldDraft[definition.key];
        }
        setBaseline(data.values);
        setDraft(next);
        setRevision(data.revision);
        setSaved("Settings saved.");
      },
    });
  };
  const cancel = () => {
    setSaved(undefined);
    if (!currentBaseline) return;
    if (active === "preferences") {
      setPreferenceDraft({
        ...preferenceDraft,
        ...pick(currentBaseline, currentDefinitions),
      });
      return;
    }
    setDraft({ ...draft, ...pick(currentBaseline, currentDefinitions) });
  };
  const reload = () => {
    setBaseline(undefined);
    setPreferenceBaseline(undefined);
    setSaved(undefined);
    void settings.refetch();
    void preferences.refetch();
  };
  if (settings.isLoading)
    return <div className="table-loading">Loading settings…</div>;
  return (
    <SettingsShell
      active={active}
      dirty={dirty}
      onNavigate={(next) => {
        setSaved(undefined);
        return (
          next === active ||
          !currentDirty ||
          confirm(
            "This section has unsaved changes. Keep them and open another Settings section?",
          )
        );
      }}
    >
      <Destination
        active={active}
        manageable={manageable}
        owner={owner}
        definitions={currentDefinitions}
        values={currentValues}
        onChange={(key, value) => {
          setSaved(undefined);
          if (active === "preferences")
            setPreferenceDraft({ ...preferenceDraft, [key]: value });
          else setDraft({ ...draft, [key]: value });
        }}
      />
      <SettingsActionBar
        dirty={currentDirty}
        saving={saveOrganization.isPending || savePreferences.isPending}
        success={saved}
        error={errorMessage(saveOrganization.error ?? savePreferences.error)}
        onCancel={cancel}
        onSave={save}
        onReload={
          isConflict(saveOrganization.error ?? savePreferences.error)
            ? reload
            : undefined
        }
      />
    </SettingsShell>
  );
}

function Destination({
  active,
  manageable,
  owner,
  definitions,
  values,
  onChange,
}: {
  active: SettingsSectionId;
  manageable: boolean;
  owner: boolean;
  definitions: SettingDefinition[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (active === "users") return <UsersPage />;
  if (active === "system") return <SystemPanel canManage={manageable} />;
  if (active === "import-export") return <ImportExportPanel owner={owner} />;
  if (active === "player-updates")
    return <PlayerUpdatesPanel owner={owner} manageable={manageable} />;
  let before: React.ReactNode;
  if (active === "branding")
    before = (
      <>
        <BrandingAssets
          values={values}
          editable={manageable}
          onChange={onChange}
        />
        <BrandingPreview values={values} />
      </>
    );
  if (active === "accessibility")
    before = (
      <div className="notice notice--info">
        <strong>Local setup is required on every player.</strong>
        <p>
          Accessibility Control Assist must be enabled manually in Android
          Accessibility Settings. Enabling policy here does not grant Android
          permission.
        </p>
      </div>
    );
  if (
    active === "power" &&
    values["power.active_hours_enabled"] === true &&
    values["power.active_hours_start"] === values["power.active_hours_end"]
  )
    before = (
      <div className="notice notice--warning" role="alert">
        Start and end times are identical. Choose a distinct range; an earlier
        end time is treated as overnight.
      </div>
    );
  const visibleDefinitions =
    active === "branding"
      ? definitions.filter(
          (definition) =>
            ![
              "branding.logo_asset_id",
              "branding.icon_asset_id",
              "branding.primary_color",
              "branding.player_background_color",
              "branding.player_text_color",
            ].includes(definition.key),
        )
      : definitions;
  return (
    <SettingsSection
      section={active}
      definitions={visibleDefinitions}
      values={values}
      editable={active === "preferences" || manageable}
      onChange={onChange}
      before={before}
    />
  );
}
function BrandingPreview({ values }: { values: Record<string, unknown> }) {
  return (
    <div className="branding-workspace">
      <div>
        <h3>Player preview</h3>
        <div
          className="branding-preview"
          style={{
            background: signalColors.playerBackground,
            color: signalColors.playerText,
          }}
        >
          <strong>
            {text(values["branding.no_content_title"], "No content assigned")}
          </strong>
          <span>
            {text(
              values["branding.no_content_message"],
              "This screen is ready for content.",
            )}
          </span>
          <small>{text(values["branding.footer_text"], "Tilecast")}</small>
        </div>
      </div>
      <p>
        Emergency takeover keeps Tilecast’s fixed high-contrast treatment
        regardless of custom branding.
      </p>
    </div>
  );
}
function definitionsFor(
  section: SettingsSectionId,
  definitions: SettingDefinition[],
) {
  const category = section === "reliability" ? "reliability" : section;
  return definitions.filter(
    (definition) =>
      definition.category === category ||
      (section === "websites" && definition.category === "websites"),
  );
}
function dirtySections(
  definitions: SettingDefinition[],
  baseline: Record<string, unknown>,
  draft: Record<string, unknown>,
) {
  const result = new Set<SettingsSectionId>();
  for (const section of [
    "general",
    "branding",
    "playback",
    "media",
    "websites",
    "scheduling",
    "reliability",
    "power",
    "accessibility",
    "emergency",
    "retention",
  ] as SettingsSectionId[])
    if (sectionDirty(definitionsFor(section, definitions), baseline, draft))
      result.add(section);
  return result;
}
function sectionDirty(
  definitions: SettingDefinition[],
  baseline: Record<string, unknown>,
  draft: Record<string, unknown>,
) {
  return definitions.some(
    (definition) =>
      !same(
        baseline[definition.key] ?? definition.default,
        draft[definition.key] ?? definition.default,
      ),
  );
}
function pick(
  values: Record<string, unknown>,
  definitions: SettingDefinition[],
) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      values[definition.key] ?? definition.default,
    ]),
  );
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function text(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}
function isConflict(error: Error | null | undefined) {
  return (
    error instanceof ApiError && error.code === "settings_revision_conflict"
  );
}
function errorMessage(error: Error | null | undefined) {
  if (!error) return undefined;
  return isConflict(error)
    ? "These settings changed elsewhere. Reload the latest settings before saving."
    : error.message;
}
function applyPreferences(values: Record<string, unknown>) {
  const root = document.documentElement;
  root.dataset.theme =
    typeof values["preference.appearance"] === "string"
      ? String(values["preference.appearance"])
      : "system";
  root.dataset.density =
    typeof values["preference.density"] === "string"
      ? String(values["preference.density"])
      : "comfortable";
  root.dataset.reducedMotion = String(
    Boolean(values["preference.reduced_motion"]),
  );
}
function useNavigationWarning(dirty: boolean) {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest("a");
      if (
        link &&
        !link.getAttribute("href")?.startsWith("/settings") &&
        !confirm("Leave Settings with unsaved changes?")
      )
        event.preventDefault();
    };
    addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty]);
}
