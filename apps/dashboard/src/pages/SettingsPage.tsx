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
  "player-updates",
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
  "player-updates": "Player Updates",
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
        ) : section === "player-updates" ? (
          <PlayerUpdatesPanel owner={owner} manageable={manageable} />
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

function PlayerUpdatesPanel({
  owner,
  manageable,
}: {
  owner: boolean;
  manageable: boolean;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const releases = useQuery({
    queryKey: ["player-releases"],
    queryFn: api.playerReleases,
    refetchInterval: 10_000,
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
    refetchInterval: 10_000,
  });
  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const groups = useQuery({
    queryKey: ["screen-groups"],
    queryFn: () => api.screenGroups(),
  });
  const [selectedRelease, setSelectedRelease] = useState("");
  const [selectedScreens, setSelectedScreens] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [mode, setMode] = useState("download_only");
  const [maintenanceWindow, setMaintenanceWindow] = useState("");
  const check = useMutation({
    mutationFn: () => api.checkPlayerReleases(auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["player-releases"] }),
  });
  const cache = useMutation({
    mutationFn: (id: string) =>
      api.cachePlayerRelease(id, auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["player-releases"] }),
  });
  const deploy = useMutation({
    mutationFn: () =>
      api.createUpdateDeployment(
        {
          releaseId: selectedRelease,
          name: `Tilecast Player ${releases.data?.items.find((item) => item.id === selectedRelease)?.versionName ?? "update"}`,
          mode,
          screenIds: selectedScreens,
          groupIds: selectedGroups,
          maintenanceWindowStart:
            mode === "maintenance_window" && maintenanceWindow
              ? new Date(maintenanceWindow).toISOString()
              : undefined,
        },
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: () => {
      setSelectedScreens([]);
      setSelectedGroups([]);
      void queryClient.invalidateQueries({ queryKey: ["update-deployments"] });
    },
  });
  const release = releases.data?.items.find(
    (item) => item.id === selectedRelease,
  );
  const explicitTargets = new Set(selectedScreens);
  for (const group of groups.data?.items ?? []) {
    if (selectedGroups.includes(group.id))
      for (const screen of group.screens) explicitTargets.add(screen.id);
  }
  const targetScreens = (screens.data?.items ?? []).filter((screen) =>
    explicitTargets.has(screen.id),
  );
  return (
    <div className="settings-stack">
      <section className="detail-card">
        <div className="detail-card__heading">
          <div>
            <h3>GitHub Releases</h3>
            <p>
              Repository: <code>Gibsonmb71/tilecast</code>
            </p>
          </div>
          {owner && (
            <button
              className="button button--primary"
              onClick={() => check.mutate()}
              disabled={check.isPending}
            >
              {check.isPending ? "Checking…" : "Check now"}
            </button>
          )}
        </div>
        <p>
          Last check:{" "}
          {releases.data?.lastCheckedAt
            ? new Date(releases.data.lastCheckedAt).toLocaleString()
            : "Never"}
        </p>
        {releases.data?.providerError && (
          <div className="notice notice--error">
            {releases.data.providerError}
          </div>
        )}
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Channel</th>
                <th>Published</th>
                <th>APK</th>
                <th>Verification</th>
                <th>Cache</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(releases.data?.items ?? []).map((release) => (
                <tr key={release.id}>
                  <td>
                    <strong>{release.versionName}</strong>
                    <small>Code {release.versionCode}</small>
                  </td>
                  <td>
                    {release.channel === "beta" ? "Beta prerelease" : "Stable"}
                  </td>
                  <td>{new Date(release.publishedAt).toLocaleDateString()}</td>
                  <td>{(release.apkSizeBytes / 1024 / 1024).toFixed(1)} MB</td>
                  <td>
                    <span
                      className={`status-pill status-pill--${release.verificationStatus === "verified" ? "success" : release.verificationStatus === "failed" ? "danger" : "warning"}`}
                    >
                      {release.verificationStatus.replaceAll("_", " ")}
                    </span>
                    {release.verificationError && (
                      <small>{release.verificationError}</small>
                    )}
                  </td>
                  <td>{release.cacheStatus}</td>
                  <td>
                    {owner &&
                      release.verificationStatus !== "verified" &&
                      release.cacheStatus !== "downloading" && (
                        <button
                          className="button button--quiet"
                          onClick={() => cache.mutate(release.id)}
                        >
                          {release.verificationStatus === "failed"
                            ? "Retry verification"
                            : "Download and verify"}
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {manageable && (
        <section className="detail-card">
          <h3>Deploy player update</h3>
          <p>
            Targets selected through both screens and groups are deduplicated
            when deployment begins. Installation waits while emergency playback
            is active.
          </p>
          <label>
            Verified release
            <select
              value={selectedRelease}
              onChange={(event) => setSelectedRelease(event.target.value)}
            >
              <option value="">Select a release</option>
              {(releases.data?.items ?? [])
                .filter(
                  (item) =>
                    item.verificationStatus === "verified" &&
                    item.cacheStatus === "cached",
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.versionName} · {item.channel}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Mode
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="download_only">Download only</option>
              <option value="install_now">
                Download and request installation
              </option>
              <option value="maintenance_window">Maintenance window</option>
            </select>
          </label>
          {mode === "maintenance_window" && (
            <label>
              Maintenance window start
              <input
                type="datetime-local"
                value={maintenanceWindow}
                onChange={(event) => setMaintenanceWindow(event.target.value)}
              />
            </label>
          )}
          {selectedRelease && targetScreens.length > 0 && (
            <div className="notice">
              <strong>{targetScreens.length} affected screens</strong>
              <p>
                {selectedScreens.length +
                  selectedGroups.reduce(
                    (total, id) =>
                      total +
                      (groups.data?.items.find((group) => group.id === id)
                        ?.membershipCount ?? 0),
                    0,
                  ) -
                  targetScreens.length}{" "}
                duplicate targets removed ·{" "}
                {
                  targetScreens.filter((screen) => screen.status === "offline")
                    .length
                }{" "}
                offline ·{" "}
                {
                  targetScreens.filter(
                    (screen) =>
                      screen.playerVersionCode !== undefined &&
                      release &&
                      screen.playerVersionCode >= release.versionCode,
                  ).length
                }{" "}
                already current ·{" "}
                {
                  targetScreens.filter(
                    (screen) => !screen.installPermissionStatus,
                  ).length
                }{" "}
                unknown install permission
              </p>
              <p>
                Maximum download:{" "}
                {(
                  ((release?.apkSizeBytes ?? 0) * targetScreens.length) /
                  1024 /
                  1024
                ).toFixed(1)}{" "}
                MB. Emergency-active players download but delay installation.
              </p>
            </div>
          )}
          <div className="policy-fields">
            <fieldset>
              <legend>Screens</legend>
              {(screens.data?.items ?? []).map((screen) => (
                <label key={screen.id}>
                  <input
                    type="checkbox"
                    checked={selectedScreens.includes(screen.id)}
                    onChange={(event) =>
                      setSelectedScreens(
                        event.target.checked
                          ? [...selectedScreens, screen.id]
                          : selectedScreens.filter((id) => id !== screen.id),
                      )
                    }
                  />
                  {screen.name} · {screen.playerVersion} · {screen.status}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Groups</legend>
              {(groups.data?.items ?? []).map((group) => (
                <label key={group.id}>
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(group.id)}
                    onChange={(event) =>
                      setSelectedGroups(
                        event.target.checked
                          ? [...selectedGroups, group.id]
                          : selectedGroups.filter((id) => id !== group.id),
                      )
                    }
                  />
                  {group.name} · {group.membershipCount} screens
                </label>
              ))}
            </fieldset>
          </div>
          <button
            className="button button--primary"
            disabled={
              !selectedRelease ||
              selectedScreens.length + selectedGroups.length === 0 ||
              (mode === "maintenance_window" && !maintenanceWindow) ||
              deploy.isPending
            }
            onClick={() => {
              if (
                confirm(
                  "Deploy player update? Android may require approval on each TV.",
                )
              )
                deploy.mutate();
            }}
          >
            Deploy player update
          </button>
          {deploy.error && (
            <div className="notice notice--error">{deploy.error.message}</div>
          )}
        </section>
      )}
      <section className="detail-card">
        <h3>Deployments</h3>
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Targets</th>
                <th>Succeeded</th>
                <th>Waiting for user</th>
                <th>Failed</th>
              </tr>
            </thead>
            <tbody>
              {(deployments.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.name}
                    <small>
                      {item.versionName} ({item.versionCode})
                    </small>
                  </td>
                  <td>{item.mode.replaceAll("_", " ")}</td>
                  <td>{item.status}</td>
                  <td>{item.targetCount}</td>
                  <td>{item.succeededCount}</td>
                  <td>{item.waitingForUserCount}</td>
                  <td>{item.failedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function playerUpdateStateLabel(state: string) {
  return state === "waiting_for_user"
    ? "Waiting for user — approval required on TV"
    : state === "waiting_for_permission"
      ? "Waiting for install permission"
      : state.replaceAll("_", " ");
}

export function canDeployPlayerUpdates(role: string | undefined) {
  return role === "owner" || role === "administrator";
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
    "player-updates": "Signed Tilecast Player APK releases from GitHub.",
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
