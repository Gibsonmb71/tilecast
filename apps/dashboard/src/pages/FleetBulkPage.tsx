import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { api } from "../api/client";
import type {
  BulkAction,
  BulkOperation,
  BulkOperationRequest,
  BulkPreview,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { PageHeader, Select } from "../components/ui";

const actionLabels: Record<BulkAction, string> = {
  assign_playlist: "Assign a playlist",
  assign_layout: "Assign a Layout",
  clear_assignment: "Remove the assignment",
  set_enabled: "Enable or disable playback",
  send_command: "Send a command",
};

// The bulk command set is deliberately the safe, idempotent subset. A command
// that takes a screen off the air is a per-screen decision.
const bulkCommands = [
  { value: "sync_now", label: "Sync now" },
  { value: "reload_playback", label: "Reload playback" },
  { value: "clear_media_cache", label: "Clear media cache" },
  { value: "restart_player_process", label: "Restart the Player" },
];

export function FleetBulkPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";

  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const playlists = useQuery({
    queryKey: ["playlists"],
    queryFn: () => api.playlists(),
  });
  const layouts = useQuery({
    queryKey: ["layouts"],
    queryFn: () => api.layouts(),
  });
  const operations = useQuery({
    queryKey: ["bulk-operations"],
    queryFn: () => api.bulkOperations(5),
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [action, setAction] = useState<BulkAction>("assign_playlist");
  const [playlistId, setPlaylistId] = useState("");
  const [layoutId, setLayoutId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [commandType, setCommandType] = useState("sync_now");
  const [preview, setPreview] = useState<BulkPreview>();
  const [result, setResult] = useState<BulkOperation>();
  // Kept separately because apply clears the preview before the result renders.
  const [undoWindowMinutes, setUndoWindowMinutes] = useState<number>();

  const items = screens.data?.items ?? [];

  function buildRequest(): BulkOperationRequest {
    const request: BulkOperationRequest = { screenIds: selected, action };
    if (action === "assign_playlist") request.playlistId = playlistId;
    if (action === "assign_layout") request.layoutId = layoutId;
    if (action === "set_enabled") request.enabled = enabled;
    if (action === "send_command") request.commandType = commandType;
    return request;
  }

  const build = useMutation({
    mutationFn: () => api.previewBulkOperation(buildRequest()),
    onSuccess: (data) => {
      setPreview(data);
      setResult(undefined);
      setUndoWindowMinutes(data.undoWindowMinutes);
    },
  });
  const apply = useMutation({
    mutationFn: () =>
      api.applyBulkOperation(
        { ...buildRequest(), expectedChangeCount: preview?.changeCount ?? 0 },
        csrf,
      ),
    onSuccess: (data) => {
      setResult(data);
      setPreview(undefined);
      void client.invalidateQueries({ queryKey: ["screens"] });
      void client.invalidateQueries({ queryKey: ["bulk-operations"] });
    },
  });
  const undo = useMutation({
    mutationFn: (id: string) => api.undoBulkOperation(id, csrf),
    onSuccess: () => {
      setResult(undefined);
      void client.invalidateQueries({ queryKey: ["screens"] });
      void client.invalidateQueries({ queryKey: ["bulk-operations"] });
    },
  });

  const ready =
    selected.length > 0 &&
    (action !== "assign_playlist" || playlistId !== "") &&
    (action !== "assign_layout" || layoutId !== "");

  return (
    <section>
      <PageHeader
        title="Bulk changes"
        description="Apply one change to many screens. Tilecast shows exactly what will change before anything happens, including screens pulled in by a Display Group."
      />

      <div className="settings-sections">
        <section className="settings-subsection">
          <header>
            <h3>Screens</h3>
            <p>
              A screen in a Display Group shares that group&apos;s assignment,
              so selecting one member includes the rest. The preview lists them.
            </p>
          </header>
          <div className="settings-subsection__action">
            <div>
              <span>
                {selected.length} of {items.length} selected
              </span>
            </div>
            <button
              className="button button--quiet"
              onClick={() =>
                setSelected(
                  selected.length === items.length
                    ? []
                    : items.map((item) => item.id),
                )
              }
            >
              {selected.length === items.length ? "Select none" : "Select all"}
            </button>
          </div>
          <div className="bulk-screen-picker">
            {items.map((item) => (
              <label className="checkbox-control" key={item.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  onChange={(event) => {
                    setPreview(undefined);
                    setSelected((ids) =>
                      event.target.checked
                        ? [...ids, item.id]
                        : ids.filter((id) => id !== item.id),
                    );
                  }}
                />
                <span>
                  {item.name}
                  <small>
                    {item.syncGroupName
                      ? `Display Group: ${item.syncGroupName}`
                      : item.location || "No location"}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-subsection">
          <header>
            <h3>Change</h3>
          </header>
          <div className="setting-row">
            <div className="setting-copy">
              <label htmlFor="bulk-action">Action</label>
            </div>
            <div className="setting-control">
              <Select
                id="bulk-action"
                value={action}
                onChange={(event) => {
                  setAction(event.target.value as BulkAction);
                  setPreview(undefined);
                }}
              >
                {(Object.keys(actionLabels) as BulkAction[]).map((value) => (
                  <option key={value} value={value}>
                    {actionLabels[value]}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {action === "assign_playlist" && (
            <div className="setting-row">
              <div className="setting-copy">
                <label htmlFor="bulk-playlist">Playlist</label>
              </div>
              <div className="setting-control">
                <Select
                  id="bulk-playlist"
                  value={playlistId}
                  onChange={(event) => {
                    setPlaylistId(event.target.value);
                    setPreview(undefined);
                  }}
                >
                  <option value="">Select a playlist</option>
                  {playlists.data?.items?.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {action === "assign_layout" && (
            <div className="setting-row">
              <div className="setting-copy">
                <label htmlFor="bulk-layout">Layout</label>
                <p>Only published Layouts can be assigned.</p>
              </div>
              <div className="setting-control">
                <Select
                  id="bulk-layout"
                  value={layoutId}
                  onChange={(event) => {
                    setLayoutId(event.target.value);
                    setPreview(undefined);
                  }}
                >
                  <option value="">Select a Layout</option>
                  {layouts.data?.items?.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {action === "set_enabled" && (
            <div className="setting-row">
              <div className="setting-copy">
                <label htmlFor="bulk-enabled">Playback</label>
              </div>
              <div className="setting-control">
                <Select
                  id="bulk-enabled"
                  value={enabled ? "enabled" : "disabled"}
                  onChange={(event) => {
                    setEnabled(event.target.value === "enabled");
                    setPreview(undefined);
                  }}
                >
                  <option value="enabled">Enable playback</option>
                  <option value="disabled">Disable playback</option>
                </Select>
              </div>
            </div>
          )}

          {action === "send_command" && (
            <div className="setting-row">
              <div className="setting-copy">
                <label htmlFor="bulk-command">Command</label>
                <p>A command cannot be undone once a Player collects it.</p>
              </div>
              <div className="setting-control">
                <Select
                  id="bulk-command"
                  value={commandType}
                  onChange={(event) => {
                    setCommandType(event.target.value);
                    setPreview(undefined);
                  }}
                >
                  {bulkCommands.map((command) => (
                    <option key={command.value} value={command.value}>
                      {command.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          <div className="settings-subsection__action">
            <div />
            <button
              className="button button--primary"
              disabled={!ready || build.isPending}
              onClick={() => build.mutate()}
            >
              {build.isPending ? "Checking…" : "Preview the change"}
            </button>
          </div>
          {build.error && (
            <div className="notice notice--error" role="alert">
              {build.error.message}
            </div>
          )}
        </section>

        {preview && (
          <PreviewSection
            preview={preview}
            applying={apply.isPending}
            error={apply.error?.message}
            onApply={() => apply.mutate()}
            onCancel={() => setPreview(undefined)}
          />
        )}

        {result && (
          <section className="settings-subsection">
            <header>
              <h3>Applied</h3>
            </header>
            <p className="backup-summary">
              {result.appliedCount} changed, {result.skippedCount} unchanged or
              skipped
              {result.failedCount > 0 ? `, ${result.failedCount} failed` : ""}.
            </p>
            {result.failedCount > 0 && (
              <div className="notice notice--error" role="alert">
                Some screens did not change:
                <ul>
                  {result.results
                    .filter((row) => row.error)
                    .map((row) => (
                      <li key={row.screenId}>
                        {row.name}: {row.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {result.reversible && (
              <div className="settings-subsection__action">
                <div>
                  <p>
                    You can put this back for the next {undoWindowMinutes ?? 15}{" "}
                    minutes.
                  </p>
                </div>
                <button
                  className="button"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate(result.id)}
                >
                  <RotateCcw size={15} />{" "}
                  {undo.isPending ? "Undoing…" : "Undo this change"}
                </button>
              </div>
            )}
            {undo.error && (
              <div className="notice notice--error" role="alert">
                {undo.error.message}
              </div>
            )}
          </section>
        )}

        <section className="settings-subsection">
          <header>
            <h3>Recent bulk changes</h3>
          </header>
          {!operations.data?.length ? (
            <div className="empty-card">No bulk changes yet.</div>
          ) : (
            <div className="backup-job-list">
              {operations.data.map((operation) => (
                <div key={operation.id}>
                  <span>
                    <strong>{actionLabels[operation.action]}</strong>
                    <small>
                      {new Date(operation.createdAt).toLocaleString()} ·{" "}
                      {operation.appliedCount} screens
                      {operation.undoneAt ? " · undone" : ""}
                    </small>
                  </span>
                  <span className="backup-job-status">
                    {operation.reversible ? (
                      <button
                        className="button button--quiet button--compact"
                        disabled={undo.isPending}
                        onClick={() => undo.mutate(operation.id)}
                      >
                        Undo
                      </button>
                    ) : operation.undoneAt ? (
                      "Undone"
                    ) : (
                      "Undo window closed"
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function PreviewSection({
  preview,
  applying,
  error,
  onApply,
  onCancel,
}: {
  preview: BulkPreview;
  applying: boolean;
  error?: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="settings-subsection">
      <header>
        <h3>What will change</h3>
        <p>
          {preview.changeCount} screens change. {preview.unchangedCount} are
          already in that state
          {preview.blockedCount > 0
            ? `, and ${preview.blockedCount} cannot be changed`
            : ""}
          .
        </p>
      </header>

      {preview.warnings.map((warning) => (
        <div className="notice" key={warning} role="status">
          {warning}
        </div>
      ))}

      <div className="backup-job-list">
        {preview.screens.map((row) => (
          <div key={row.screenId}>
            <span>
              <strong>
                {row.name}
                {row.fromGroup ? ` (via ${row.fromGroup})` : ""}
              </strong>
              <small>
                {row.current} → {row.next}
              </small>
            </span>
            <span className="backup-job-status">
              {row.blocked ? (
                <span className="status-badge status-badge--offline">
                  Skipped: {row.blocked}
                </span>
              ) : row.changes ? (
                <span className="status-badge status-badge--recent">
                  Will change
                </span>
              ) : (
                "No change"
              )}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}

      <div className="settings-subsection__action">
        <div />
        <div className="backup-row__actions">
          <button className="button button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={applying || preview.changeCount === 0}
            onClick={onApply}
          >
            {applying
              ? "Applying…"
              : `Change ${preview.changeCount} screen${preview.changeCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </section>
  );
}
