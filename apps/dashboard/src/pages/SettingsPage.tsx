import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { SettingDefinition } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

const sections = [
  "general",
  "branding",
  "playback",
  "media",
  "scheduling",
  "websites",
  "emergency",
  "retention",
  "users",
  "preferences",
  "system",
  "import-export",
] as const;
const labels: Record<string, string> = {
  general: "General",
  branding: "Branding",
  playback: "Playback",
  media: "Media",
  scheduling: "Scheduling",
  websites: "Websites",
  emergency: "Emergency and Commands",
  retention: "Retention",
  users: "Users",
  preferences: "My Preferences",
  system: "System",
  "import-export": "Import and Export",
};
export function SettingsPage() {
  const auth = useAuth();
  const manageable = ["owner", "administrator"].includes(
    auth.status?.user?.role ?? "",
  );
  const owner = auth.status?.user?.role === "owner";
  const [section, setSection] = useState<(typeof sections)[number]>("general");
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
  });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [preferenceValues, setPreferenceValues] = useState<
    Record<string, unknown>
  >({});
  useEffect(() => {
    if (settings.data) setValues(settings.data.values);
  }, [settings.data]);
  useEffect(() => {
    if (preferences.data) setPreferenceValues(preferences.data.values);
  }, [preferences.data]);
  const save = useMutation({
    mutationFn: () =>
      api.updateSettings(
        settings.data?.revision ?? 0,
        values,
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: (data) => {
      setValues(data.values);
    },
  });
  const savePreferences = useMutation({
    mutationFn: () =>
      api.updatePreferences(
        preferences.data?.revision ?? 0,
        preferenceValues,
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: (data) => {
      setPreferenceValues(data.values);
      applyPreferences(data.values);
    },
  });
  useEffect(() => applyPreferences(preferenceValues), [preferenceValues]);
  if (settings.isLoading)
    return <div className="table-loading">Loading settings…</div>;
  return (
    <div className="settings-layout">
      <aside className="settings-nav" aria-label="Settings sections">
        {sections.map((item) => (
          <button
            key={item}
            className={section === item ? "active" : ""}
            onClick={() => setSection(item)}
          >
            {labels[item]}
          </button>
        ))}
      </aside>
      <section className="settings-content">
        <header className="page-heading">
          <div>
            <h2>{labels[section]}</h2>
            <p>{description(section)}</p>
          </div>
        </header>
        {section === "branding" && (
          <div
            className="branding-preview"
            style={{
              background: settingText(
                values["branding.player_background_color"],
                "#13231E",
              ),
              color: settingText(
                values["branding.player_text_color"],
                "#FFFFFF",
              ),
            }}
          >
            <strong>
              {settingText(
                values["branding.no_content_title"],
                "No content assigned",
              )}
            </strong>
            <span>
              {settingText(
                values["branding.no_content_message"],
                "This screen is ready for content.",
              )}
            </span>
            <small>
              Player branding preview · emergency presentation keeps Tilecast’s
              fixed high-contrast treatment.
            </small>
          </div>
        )}
        {section === "preferences" ? (
          <SettingsForm
            definitions={preferences.data?.definitions ?? []}
            values={preferenceValues}
            setValues={setPreferenceValues}
            editable
            onSave={() => savePreferences.mutate()}
            saving={savePreferences.isPending}
            error={savePreferences.error}
          />
        ) : section === "users" ? (
          <UsersPanel canManage={manageable} />
        ) : section === "system" ? (
          <SystemPanel canManage={manageable} />
        ) : section === "import-export" ? (
          <ImportExport owner={owner} />
        ) : (
          <SettingsForm
            definitions={(settings.data?.definitions ?? []).filter(
              (d) => d.scope !== "preference" && category(d) === section,
            )}
            values={values}
            setValues={setValues}
            editable={manageable}
            onSave={() => save.mutate()}
            saving={save.isPending}
            error={save.error}
          />
        )}
      </section>
    </div>
  );
}

function category(d: SettingDefinition) {
  if (d.category === "playback") return "playback";
  return d.category;
}
function SettingsForm({
  definitions,
  values,
  setValues,
  editable,
  onSave,
  saving,
  error,
}: {
  definitions: SettingDefinition[];
  values: Record<string, unknown>;
  setValues: (v: Record<string, unknown>) => void;
  editable: boolean;
  onSave: () => void;
  saving: boolean;
  error: Error | null;
}) {
  const [initial, setInitial] = useState("");
  useEffect(() => {
    if (initial === "" && definitions.length > 0)
      setInitial(JSON.stringify(values));
  }, [definitions.length, initial, values]);
  const dirty = initial !== "" && initial !== JSON.stringify(values);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
        setInitial(JSON.stringify(values));
      }}
    >
      {definitions.length === 0 && (
        <p className="empty-state">
          No settings are available in this section.
        </p>
      )}
      {definitions.map((def) => (
        <SettingField
          key={def.key}
          definition={def}
          value={values[def.key] ?? def.default}
          disabled={!editable}
          onChange={(value) => setValues({ ...values, [def.key]: value })}
        />
      ))}
      {error && (
        <div className="notice notice--error">
          {error instanceof ApiError &&
          error.code === "settings_revision_conflict"
            ? "These settings changed elsewhere. Reload before saving."
            : error.message}
        </div>
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="button button--quiet"
          disabled={!dirty}
          onClick={() => {
            setValues(JSON.parse(initial) as Record<string, unknown>);
          }}
        >
          Cancel
        </button>
        {editable && (
          <button
            className="button button--primary"
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        )}
      </div>
    </form>
  );
}
function SettingField({
  definition,
  value,
  disabled,
  onChange,
}: {
  definition: SettingDefinition;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const id = definition.key;
  let control;
  if (definition.type === "bool")
    control = (
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  else if (definition.type === "enum")
    control = (
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {definition.allowed?.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  else if (definition.type === "color")
    control = (
      <span className="color-input">
        <input
          id={id}
          type="color"
          value={String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <code>{String(value)}</code>
      </span>
    );
  else
    control = (
      <input
        id={id}
        type={
          definition.type === "int" ||
          definition.type === "int64" ||
          definition.type === "float"
            ? "number"
            : definition.type === "email"
              ? "email"
              : "text"
        }
        value={
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : ""
        }
        min={definition.min}
        max={definition.max}
        step={definition.type === "float" ? "0.01" : "1"}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.type === "number"
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      />
    );
  return (
    <label className="setting-row" htmlFor={id}>
      <span>
        <strong>{definition.title}</strong>
        <small>{definition.description || definition.key}</small>
        {definition.futureOnly && <em>Applies to future processing only</em>}
        {definition.restartRequired && <em>Server restart required</em>}
      </span>
      {control}
    </label>
  );
}
function SystemPanel({ canManage }: { canManage: boolean }) {
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["system-status"],
    queryFn: api.systemStatus,
    enabled: canManage,
    refetchInterval: 30_000,
  });
  const client = useQueryClient();
  const maintenance = useMutation({
    mutationFn: (action: string) =>
      api.runMaintenance(action, auth.status?.csrfToken ?? ""),
    onSuccess: () => client.invalidateQueries({ queryKey: ["system-status"] }),
  });
  if (!canManage)
    return (
      <div className="notice">Owner or Administrator access is required.</div>
    );
  const s = query.data;
  if (!s) return <div className="table-loading">Loading diagnostics…</div>;
  return (
    <>
      <dl className="system-settings-grid">
        <div>
          <dt>Tilecast</dt>
          <dd>
            {s.tilecastVersion} · {s.buildCommit}
          </dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{Math.floor(s.uptimeSeconds / 60)} minutes</dd>
        </div>
        <div>
          <dt>Database</dt>
          <dd>
            {s.database.status} · migration {s.database.migrationVersion}
          </dd>
        </div>
        <div>
          <dt>PostgreSQL</dt>
          <dd>{s.database.postgresVersion}</dd>
        </div>
        <div>
          <dt>Connected screens</dt>
          <dd>{s.connectedScreens}</dd>
        </div>
        <div>
          <dt>Pending commands</dt>
          <dd>{s.pendingCommands}</dd>
        </div>
        <div>
          <dt>Processing jobs</dt>
          <dd>{s.activeProcessingJobs}</dd>
        </div>
        <div>
          <dt>Server timezone</dt>
          <dd>{s.serverTimezone}</dd>
        </div>
      </dl>
      <h3>Maintenance</h3>
      <div className="heading-actions">
        {[
          "expired-upload-cleanup",
          "completed-command-cleanup",
          "retention-cleanup",
          "reconcile-config",
          "validate-media",
        ].map((action) => (
          <button
            key={action}
            className="button button--quiet"
            onClick={() => {
              if (confirm(`Run ${action.replaceAll("-", " ")}?`))
                maintenance.mutate(action);
            }}
          >
            {action.replaceAll("-", " ")}
          </button>
        ))}
      </div>
    </>
  );
}
function UsersPanel({ canManage }: { canManage: boolean }) {
  const query = useQuery({
    queryKey: ["users"],
    queryFn: api.users,
    enabled: canManage,
  });
  if (!canManage)
    return (
      <div className="notice">Owner or Administrator access is required.</div>
    );
  return (
    <div className="command-history">
      {query.data?.items.map((user) => (
        <div key={user.id}>
          <strong>{user.name}</strong>
          <span>{user.username}</span>
          <small>
            {user.role} · {user.active ? "active" : "inactive"}
          </small>
        </div>
      ))}
    </div>
  );
}
function ImportExport({ owner }: { owner: boolean }) {
  const auth = useAuth();
  const [document, setDocument] = useState<unknown>();
  const [preview, setPreview] = useState<{
    changedKeys: string[];
    groupPolicyCount: number;
    screenPolicyCount: number;
  } | null>(null);
  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewSettingsImport(document, auth.status?.csrfToken ?? ""),
    onSuccess: setPreview,
  });
  const apply = useMutation({
    mutationFn: () =>
      api.applySettingsImport(document, auth.status?.csrfToken ?? ""),
  });
  if (!owner)
    return (
      <div className="notice">
        Only the Owner may import or export settings.
      </div>
    );
  return (
    <div className="import-export">
      <button
        className="button button--primary"
        onClick={() => {
          void (async () => {
            const data = await api.exportSettings();
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            });
            const link = Object.assign(documentGlobal().createElement("a"), {
              href: URL.createObjectURL(blob),
              download: `tilecast-settings-${new Date().toISOString().slice(0, 10)}.json`,
            });
            link.click();
            URL.revokeObjectURL(link.href);
          })();
        }}
      >
        Export non-secret settings
      </button>
      <label>
        Import settings file
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            void (async () => {
              const file = e.target.files?.[0];
              if (!file) return;
              setDocument(JSON.parse(await file.text()));
              setPreview(null);
            })();
          }}
        />
      </label>
      <button
        className="button button--quiet"
        disabled={!document}
        onClick={() => previewMutation.mutate()}
      >
        Validate and preview
      </button>
      {preview && (
        <div className="notice">
          <strong>{preview.changedKeys.length} setting keys are valid.</strong>
          <p>
            {preview.groupPolicyCount} group policies and{" "}
            {preview.screenPolicyCount} screen policies are present.
          </p>
          <button
            className="button button--primary"
            onClick={() => {
              if (confirm("Apply this validated settings document?"))
                apply.mutate();
            }}
          >
            Apply imported settings
          </button>
        </div>
      )}
    </div>
  );
}
function documentGlobal() {
  return window.document;
}
function settingText(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}
function applyPreferences(values: Record<string, unknown>) {
  const root = document.documentElement;
  root.dataset.theme =
    typeof values["preference.appearance"] === "string"
      ? values["preference.appearance"]
      : "system";
  root.dataset.density =
    typeof values["preference.density"] === "string"
      ? values["preference.density"]
      : "comfortable";
  root.dataset.reducedMotion = String(
    Boolean(values["preference.reduced_motion"]),
  );
}
function description(section: string) {
  return {
    general: "Organization identity, locale, timezone, and support details.",
    branding: "Studio and player colors, images, and fallback messages.",
    playback: "Organization player defaults and safe operational intervals.",
    media: "Upload and future media-processing defaults.",
    scheduling: "Schedule preparation and clock defaults.",
    websites: "Default hardened website behavior.",
    emergency: "Emergency and persistent-command defaults.",
    retention: "Bounded cleanup and history policies.",
    users: "Local Tilecast accounts and role status.",
    preferences: "Preferences for your Studio account only.",
    system: "Safe diagnostics and maintenance actions.",
    "import-export": "Portable non-secret Tilecast configuration.",
  }[section];
}

export function PlayerPolicyEditor({
  target,
  id,
}: {
  target: "group" | "screen";
  id: string;
}) {
  const auth = useAuth();
  const manageable = ["owner", "administrator"].includes(
    auth.status?.user?.role ?? "",
  );
  const settings = useQuery({
    queryKey: ["settings", "policy-definitions"],
    queryFn: api.settings,
  });
  const policy = useQuery({
    queryKey: [target, id, "policy"],
    queryFn: () =>
      target === "group" ? api.groupPolicy(id) : api.screenPolicy(id),
  });
  const effective = useQuery({
    queryKey: ["screens", id, "effective-policy"],
    queryFn: () => api.effectivePolicy(id),
    enabled: target === "screen",
  });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [priority, setPriority] = useState(0);
  useEffect(() => {
    if (policy.data) {
      setValues(policy.data.values);
      setPriority(policy.data.priority ?? 0);
    }
  }, [policy.data]);
  const save = useMutation({
    mutationFn: () =>
      target === "group"
        ? api.putGroupPolicy(
            id,
            policy.data?.revision ?? 0,
            priority,
            values,
            auth.status?.csrfToken ?? "",
          )
        : api.putScreenPolicy(
            id,
            policy.data?.revision ?? 0,
            values,
            auth.status?.csrfToken ?? "",
          ),
    onSuccess: () => {
      void policy.refetch();
      void effective.refetch();
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      target === "group"
        ? api.deleteGroupPolicy(id, auth.status?.csrfToken ?? "")
        : api.deleteScreenPolicy(id, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      setValues({});
      void policy.refetch();
      void effective.refetch();
    },
  });
  const definitions = (settings.data?.definitions ?? []).filter(
    (d) => d.scope === "policy",
  );
  return (
    <section className="detail-card policy-editor">
      <h3>Player Policy</h3>
      <p>
        {target === "group"
          ? "Overrides organization defaults. Higher policy priority wins when screens belong to multiple groups."
          : "Screen overrides have the highest precedence."}
      </p>
      {target === "group" && (
        <label>
          Policy priority
          <input
            type="number"
            min={-1000}
            max={1000}
            value={priority}
            disabled={!manageable}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </label>
      )}
      <div className="policy-fields">
        {definitions.map((def) => {
          const overridden = Object.hasOwn(values, def.key);
          const inherited =
            target === "screen" ? effective.data?.values[def.key] : undefined;
          return (
            <div className="policy-field" key={def.key}>
              <label>
                <input
                  type="checkbox"
                  checked={overridden}
                  disabled={!manageable}
                  onChange={(e) => {
                    const next = { ...values };
                    if (e.target.checked)
                      next[def.key] =
                        inherited?.value ??
                        settings.data?.values[def.key] ??
                        def.default;
                    else delete next[def.key];
                    setValues(next);
                  }}
                />
                Override {def.title}
              </label>
              {overridden ? (
                <SettingField
                  definition={def}
                  value={values[def.key]}
                  disabled={!manageable}
                  onChange={(value) =>
                    setValues({ ...values, [def.key]: value })
                  }
                />
              ) : (
                <small>
                  Inherited:{" "}
                  {String(
                    inherited?.value ??
                      settings.data?.values[def.key] ??
                      def.default,
                  )}
                  {inherited
                    ? ` · ${inherited.source}`
                    : " · Organization default"}
                </small>
              )}
            </div>
          );
        })}
      </div>
      {effective.data && (
        <p>
          Effective configuration revision {effective.data.configRevision} ·{" "}
          {effective.data.hash.slice(0, 12)}
        </p>
      )}
      {manageable && (
        <div className="settings-actions">
          <button
            className="button button--danger-quiet"
            onClick={() => {
              if (confirm("Reset all policy overrides?")) reset.mutate();
            }}
          >
            Reset all overrides
          </button>
          <button
            className="button button--primary"
            onClick={() => save.mutate()}
          >
            Save policy
          </button>
        </div>
      )}
    </section>
  );
}
