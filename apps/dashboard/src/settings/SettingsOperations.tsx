import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export function UsersPanel({ canManage }: { canManage: boolean }) {
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
    <section className="settings-subsection">
      <header>
        <h3>Studio users</h3>
        <p>
          Accounts are ordered by name. Roles determine access to administrative
          settings.
        </p>
      </header>
      <div className="command-history">
        {query.data?.items.map((user) => (
          <div key={user.id}>
            <strong>{user.name}</strong>
            <span>{user.username}</span>
            <small>
              {humanize(user.role)} · {user.active ? "Active" : "Inactive"}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}

const maintenanceActions = [
  {
    id: "expired-upload-cleanup",
    label: "Clean up expired uploads",
    description:
      "Removes expired temporary upload data according to retention policy.",
    confirm: true,
  },
  {
    id: "completed-command-cleanup",
    label: "Clean up command history",
    description:
      "Removes completed commands older than the configured retention period.",
    confirm: true,
  },
  {
    id: "retention-cleanup",
    label: "Run retention cleanup",
    description:
      "Applies configured retention policies to eligible operational records.",
    confirm: true,
  },
  {
    id: "reconcile-config",
    label: "Reconcile player configuration",
    description:
      "Asks connected players to retrieve their current effective configuration.",
    confirm: false,
  },
  {
    id: "validate-media",
    label: "Validate media storage",
    description:
      "Checks media storage and processing-tool availability without changing content.",
    confirm: false,
  },
];
export function SystemPanel({ canManage }: { canManage: boolean }) {
  const auth = useAuth();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["system-status"],
    queryFn: api.systemStatus,
    enabled: canManage,
    refetchInterval: 30_000,
  });
  const maintenance = useMutation({
    mutationFn: (action: string) =>
      api.runMaintenance(action, auth.status?.csrfToken ?? ""),
    onSuccess: () => client.invalidateQueries({ queryKey: ["system-status"] }),
  });
  if (!canManage)
    return (
      <div className="notice">Owner or Administrator access is required.</div>
    );
  if (!query.data)
    return <div className="table-loading">Loading diagnostics…</div>;
  const s = query.data;
  return (
    <div className="settings-sections">
      <section className="settings-subsection">
        <header>
          <h3>Diagnostics</h3>
          <p>
            Safe runtime information. Secrets and sensitive filesystem paths are
            never shown.
          </p>
        </header>
        <dl className="system-settings-grid">
          <Item
            label="Tilecast"
            value={`${s.tilecastVersion} · ${s.buildCommit}`}
          />
          <Item label="Uptime" value={formatDuration(s.uptimeSeconds)} />
          <Item
            label="Database"
            value={`${s.database.status} · migration ${s.database.migrationVersion}`}
          />
          <Item label="PostgreSQL" value={s.database.postgresVersion} />
          <Item label="Connected screens" value={String(s.connectedScreens)} />
          <Item label="Pending commands" value={String(s.pendingCommands)} />
          <Item
            label="Processing jobs"
            value={String(s.activeProcessingJobs)}
          />
          <Item label="Server timezone" value={s.serverTimezone} />
        </dl>
      </section>
      <section className="settings-subsection">
        <header>
          <h3>Maintenance</h3>
          <p>
            Run bounded maintenance tasks. Tilecast does not expose shell
            commands or destructive database controls.
          </p>
        </header>
        <div className="maintenance-list">
          {maintenanceActions.map((action) => (
            <div key={action.id}>
              <span>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
              <button
                className="button button--quiet"
                disabled={maintenance.isPending}
                onClick={() => {
                  if (!action.confirm || confirm(`${action.label}?`))
                    maintenance.mutate(action.id);
                }}
              >
                {maintenance.isPending && maintenance.variables === action.id
                  ? "Running…"
                  : "Run"}
              </button>
            </div>
          ))}
        </div>
        {maintenance.isSuccess && (
          <div className="notice notice--success" role="status">
            Maintenance action completed.
          </div>
        )}
        {maintenance.error && (
          <div className="notice notice--error" role="alert">
            {maintenance.error.message}
          </div>
        )}
      </section>
    </div>
  );
}
function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ImportExportPanel({ owner }: { owner: boolean }) {
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
    <div className="settings-sections">
      <section className="settings-subsection">
        <header>
          <h3>Export settings</h3>
          <p>
            Download organization settings and policy metadata without
            credentials, secrets, or media files.
          </p>
        </header>
        <button
          className="button button--primary"
          onClick={() => void exportSettings()}
        >
          Export non-secret settings
        </button>
      </section>
      <section className="settings-subsection">
        <header>
          <h3>Import settings</h3>
          <p>
            Tilecast validates the document and shows a preview before anything
            changes.
          </p>
        </header>
        <label className="file-input">
          Settings file
          <input
            type="file"
            accept="application/json"
            onChange={(event) =>
              void (async () => {
                const file = event.target.files?.[0];
                if (!file) return;
                setDocument(JSON.parse(await file.text()));
                setPreview(null);
              })
            }
          />
        </label>
        <button
          className="button button--quiet"
          disabled={!document || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? "Validating…" : "Validate and preview"}
        </button>
        {preview && (
          <div className="notice">
            <strong>
              {preview.changedKeys.length} setting keys are valid.
            </strong>
            <p>
              {preview.groupPolicyCount} group policies and{" "}
              {preview.screenPolicyCount} screen policies are present.
            </p>
            <button
              className="button button--primary"
              disabled={apply.isPending}
              onClick={() => {
                if (confirm("Apply this validated settings document?"))
                  apply.mutate();
              }}
            >
              Apply imported settings
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
async function exportSettings() {
  const data = await api.exportSettings();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const link = Object.assign(window.document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `tilecast-settings-${new Date().toISOString().slice(0, 10)}.json`,
  });
  link.click();
  URL.revokeObjectURL(link.href);
}

export function PlayerUpdatesPanel({
  owner,
  manageable,
}: {
  owner: boolean;
  manageable: boolean;
}) {
  const auth = useAuth();
  const client = useQueryClient();
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
  const [releaseId, setReleaseId] = useState("");
  const [screenIds, setScreenIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [mode, setMode] = useState("download_only");
  const [windowStart, setWindowStart] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const check = useMutation({
    mutationFn: () => api.checkPlayerReleases(auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["player-releases"] }),
  });
  const cache = useMutation({
    mutationFn: (id: string) =>
      api.cachePlayerRelease(id, auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["player-releases"] }),
  });
  const deploy = useMutation({
    mutationFn: () =>
      api.createUpdateDeployment(
        {
          releaseId,
          name: `Tilecast Player ${releases.data?.items.find((item) => item.id === releaseId)?.versionName ?? "update"}`,
          mode,
          screenIds,
          groupIds,
          maintenanceWindowStart:
            mode === "maintenance_window" && windowStart
              ? new Date(windowStart).toISOString()
              : undefined,
        },
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: () => {
      setScreenIds([]);
      setGroupIds([]);
      void client.invalidateQueries({ queryKey: ["update-deployments"] });
    },
  });
  const targetSet = new Set(screenIds);
  for (const group of groups.data?.items ?? [])
    if (groupIds.includes(group.id))
      for (const screen of group.screens) targetSet.add(screen.id);
  const selectedScreens = (screens.data?.items ?? []).filter((screen) =>
    targetSet.has(screen.id),
  );
  const query = targetSearch.toLowerCase();
  return (
    <div className="settings-sections">
      <section className="settings-subsection">
        <header className="settings-subsection__action">
          <div>
            <h3>Available releases</h3>
            <p>
              Verified releases from <code>Gibsonmb71/tilecast</code>.
            </p>
          </div>
          {owner && (
            <button
              className="button button--primary"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? "Checking…" : "Check now"}
            </button>
          )}
        </header>
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Channel</th>
                <th>Published</th>
                <th>Size</th>
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
                  <td>{release.channel === "beta" ? "Beta" : "Stable"}</td>
                  <td>{new Date(release.publishedAt).toLocaleDateString()}</td>
                  <td>{formatBytes(release.apkSizeBytes)}</td>
                  <td>{humanize(release.verificationStatus)}</td>
                  <td>{humanize(release.cacheStatus)}</td>
                  <td>
                    {owner && release.verificationStatus !== "verified" && (
                      <button
                        className="button button--quiet"
                        onClick={() => cache.mutate(release.id)}
                      >
                        Download and verify
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
        <section className="settings-subsection">
          <header>
            <h3>New deployment</h3>
            <p>
              Choose a verified release and target screens or groups. Duplicate
              screens are removed automatically.
            </p>
          </header>
          <div className="deployment-fields">
            <label>
              Verified release
              <select
                value={releaseId}
                onChange={(event) => setReleaseId(event.target.value)}
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
              Deployment mode
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
                Maintenance window
                <input
                  type="datetime-local"
                  value={windowStart}
                  onChange={(event) => setWindowStart(event.target.value)}
                />
              </label>
            )}
          </div>
          <label className="target-search">
            Search targets
            <input
              type="search"
              value={targetSearch}
              onChange={(event) => setTargetSearch(event.target.value)}
              placeholder="Screen or group name"
            />
          </label>
          <div className="target-picker">
            <div>
              <h4>Screens</h4>
              {(screens.data?.items ?? [])
                .filter((item) => item.name.toLowerCase().includes(query))
                .map((screen) => (
                  <Target
                    key={screen.id}
                    checked={screenIds.includes(screen.id)}
                    label={screen.name}
                    detail={`${screen.playerVersion} · ${screen.status}`}
                    onChange={(checked) =>
                      setScreenIds(
                        checked
                          ? [...screenIds, screen.id]
                          : screenIds.filter((id) => id !== screen.id),
                      )
                    }
                  />
                ))}
            </div>
            <div>
              <h4>Groups</h4>
              {(groups.data?.items ?? [])
                .filter((item) => item.name.toLowerCase().includes(query))
                .map((group) => (
                  <Target
                    key={group.id}
                    checked={groupIds.includes(group.id)}
                    label={group.name}
                    detail={`${group.membershipCount} screens`}
                    onChange={(checked) =>
                      setGroupIds(
                        checked
                          ? [...groupIds, group.id]
                          : groupIds.filter((id) => id !== group.id),
                      )
                    }
                  />
                ))}
            </div>
          </div>
          <div className="target-summary">
            <strong>{selectedScreens.length} deduplicated targets</strong>
            {selectedScreens.length > 0 && (
              <span>
                {
                  selectedScreens.filter(
                    (screen) => screen.status === "offline",
                  ).length
                }{" "}
                offline
              </span>
            )}
          </div>
          <button
            className="button button--primary"
            disabled={
              !releaseId ||
              !selectedScreens.length ||
              deploy.isPending ||
              (mode === "maintenance_window" && !windowStart)
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
        </section>
      )}
      <section className="settings-subsection">
        <header>
          <h3>Deployment history</h3>
          <p>
            Waiting for user means the TV still requires local installer
            approval; it is not a failure.
          </p>
        </header>
        <div className="settings-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Targets</th>
                <th>Succeeded</th>
                <th>Waiting</th>
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
                  <td>{humanize(item.mode)}</td>
                  <td>{humanize(item.status)}</td>
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
function Target({
  checked,
  label,
  detail,
  onChange,
}: {
  checked: boolean;
  label: string;
  detail: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="target-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}
export function playerUpdateStateLabel(state: string) {
  return state === "waiting_for_user"
    ? "Waiting for user — approval required on TV"
    : state === "waiting_for_permission"
      ? "Waiting for install permission"
      : humanize(state);
}
export function canDeployPlayerUpdates(role: string | undefined) {
  return role === "owner" || role === "administrator";
}
function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function formatBytes(value: number) {
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return (
    [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`]
      .filter(Boolean)
      .join(" ") || "Less than a minute"
  );
}
