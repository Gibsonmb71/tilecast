import {
  Button,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
} from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  GripVertical,
  ListVideo,
  PanelsTopLeft,
  Plus,
  Trash2,
  Globe2,
} from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api } from "../api/client";
import type {
  Asset,
  Playlist,
  PlaylistItem,
  PlaylistItemInput,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";
import {
  ContentPicker,
  type ContentPickerResult,
} from "../components/content-picker";

export function canManagePlaylists(role?: string) {
  return role !== "viewer";
}
export function playlistDuration(items: PlaylistItem[] | null | undefined) {
  const safeItems = Array.isArray(items) ? items : [];
  return safeItems.reduce<number | null>((total, item) => {
    const duration =
      item.assetType === "image" ||
      item.assetType === "widget" ||
      item.assetType === "layout"
        ? item.durationMs
        : item.videoEndOffsetMs != null
          ? item.videoEndOffsetMs - (item.videoStartOffsetMs ?? 0)
          : item.assetDurationSeconds != null
            ? Math.round(item.assetDurationSeconds * 1000) -
              (item.videoStartOffsetMs ?? 0)
            : null;
    return total == null || duration == null ? null : total + duration;
  }, 0);
}
function formatDuration(ms: number | null) {
  if (ms == null) return "Contains full-length video";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PlaylistsPage() {
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const canManage = canManagePlaylists(auth.status?.user?.role);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const query = useQuery({
    queryKey: ["playlists", search],
    queryFn: () => api.playlists(search),
  });
  const create = useMutation({
    mutationFn: () => api.createPlaylist({ name, description: "" }, csrf),
    onSuccess: (playlist) => void navigate(`/playlists/${playlist.id}`),
  });
  useEffect(() => {
    if (searchParams.get("create") === "1") setCreating(true);
  }, [searchParams]);
  const closeCreate = () => {
    setCreating(false);
    if (searchParams.has("create")) {
      const next = new URLSearchParams(searchParams);
      next.delete("create");
      setSearchParams(next, { replace: true });
    }
  };
  return (
    <section className="playlists-page">
      <PageHeader
        title="Playlists"
        description="Ordered fullscreen playback for assigned screens."
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Create playlist
            </Button>
          ) : undefined
        }
      />
      <DashboardListToolbar>
        <DashboardSearch
          value={search}
          onValueChange={setSearch}
          label="Search playlists"
          placeholder="Search playlists"
        />
      </DashboardListToolbar>
      {query.isLoading ? (
        <div className="table-loading">Loading playlists…</div>
      ) : query.data?.items?.length === 0 ? (
        <EmptyState
          className="content-empty"
          icon={<ListVideo size={24} aria-hidden="true" />}
          title="No playlists yet"
          message={
            canManage
              ? "Create a playlist, then add ready images and videos."
              : "An Owner, Administrator, or Editor can create playlists."
          }
        />
      ) : (
        <div className="playlist-list">
          {query.data?.items?.map((p) => (
            <Link key={p.id} to={`/playlists/${p.id}`}>
              <span>
                <strong>{p.name}</strong>
                <small>{p.description || "No description"}</small>
              </span>
              <span>Revision {p.revision}</span>
              <span>{p.itemCount} items</span>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={creating} title="Create playlist" onClose={closeCreate}>
        <Field label="Name">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {create.error && (
          <div className="notice notice--error">{create.error.message}</div>
        )}
        <div className="form-actions">
          <Button variant="quiet" onClick={closeCreate}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            loading={create.isPending}
            onClick={() => create.mutate()}
          >
            Create playlist
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

export function PlaylistEditorPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const canManage = canManagePlaylists(auth.status?.user?.role);
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["playlists", id],
    queryFn: () => api.playlist(id),
  });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [layoutPicker, setLayoutPicker] = useState(false);
  const [dragged, setDragged] = useState<string>();
  const layouts = useQuery({
    queryKey: ["layouts", "playlist-items"],
    queryFn: () => api.layouts(""),
  });
  useEffect(() => {
    if (query.data) {
      setName(query.data.name);
      setDescription(query.data.description);
      setDirty(false);
    }
  }, [query.data]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const update = (playlist: Playlist) =>
    client.setQueryData(["playlists", id], playlist);
  const save = useMutation({
    mutationFn: () => api.updatePlaylist(id, { name, description }, csrf),
    onSuccess: (p) => {
      update(p);
      setDirty(false);
    },
  });
  const duplicate = useMutation({
    mutationFn: () => api.duplicatePlaylist(id, csrf),
    onSuccess: (p) => void navigate(`/playlists/${p.id}`),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlaylist(id, csrf),
    onSuccess: () => void navigate("/playlists"),
  });
  const add = async (selected: Asset[]): Promise<ContentPickerResult> => {
    const failures: ContentPickerResult["failures"] = [];
    for (const asset of selected) {
      try {
        const next = await api.addPlaylistItem(
          id,
          {
            assetId: asset.id,
            durationMs:
              asset.type === "image"
                ? 10000
                : asset.type === "widget" &&
                    asset.widget?.provider === "website"
                  ? 30000
                  : undefined,
            fitMode: "contain",
            transition: "none",
            audioEnabled: asset.type !== "widget",
            volume: asset.type === "widget" ? 0 : 1,
            deliveryPolicy: asset.type === "widget" ? "stream" : "download",
          },
          csrf,
        );
        update(next);
      } catch (error) {
        failures.push({
          id: asset.id,
          name: asset.name,
          message:
            error instanceof Error ? error.message : "Could not add item.",
        });
      }
    }
    if (failures.length === 0) setPicker(false);
    return { failures };
  };
  const addLayout = async (layoutId: string) => {
    const next = await api.addPlaylistItem(
      id,
      {
        layoutId,
        durationMs: 30000,
        fitMode: "contain",
        transition: "none",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "stream",
      },
      csrf,
    );
    update(next);
    setLayoutPicker(false);
  };
  const reorder = async (target: string) => {
    if (!query.data || !dragged || dragged === target) return;
    const ids = query.data.items.map((i) => i.id);
    const from = ids.indexOf(dragged),
      to = ids.indexOf(target);
    const moved = ids.splice(from, 1)[0];
    if (!moved) return;
    ids.splice(to, 0, moved);
    update(await api.reorderPlaylist(id, ids, csrf));
    setDragged(undefined);
  };
  if (query.isLoading)
    return <div className="table-loading">Loading playlist…</div>;
  if (!query.data)
    return (
      <div className="notice notice--error">Playlist could not be loaded.</div>
    );
  const playlist = query.data;
  return (
    <section className="playlist-editor">
      <PageHeader
        title={playlist.name}
        description={
          <>
            Revision {playlist.revision} ·{" "}
            {formatDuration(playlistDuration(playlist.items))}
          </>
        }
        actions={
          canManage ? (
            <>
              <button
                className="button button--quiet"
                onClick={() => duplicate.mutate()}
              >
                <Copy size={15} />
                Duplicate
              </button>
              <button
                className="button button--danger"
                onClick={() => {
                  if (confirm(`Delete ${playlist.name}?`)) remove.mutate();
                }}
              >
                <Trash2 size={15} />
                Delete
              </button>
            </>
          ) : undefined
        }
      />
      {(playlist.warnings ?? []).map((w) => (
        <div key={w} className="notice notice--error">
          {w}
        </div>
      ))}
      {playlist.layoutUsage?.length > 0 && (
        <div className="notice notice--neutral">
          <strong>Used in Layouts</strong>
          <span>
            {(playlist.layoutUsage ?? []).map((layout, index) => (
              <span key={layout.id}>
                {index > 0 ? ", " : ""}
                <Link to={`/layouts/${layout.id}`}>{layout.name}</Link>
                {layout.published ? " (published)" : " (draft)"}
              </span>
            ))}
          </span>
        </div>
      )}
      <section className="playlist-settings">
        <label className="field">
          <span className="field__label">Name</span>
          <input
            disabled={!canManage}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            disabled={!canManage}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        {canManage && (
          <button
            className="button button--primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            Save details
          </button>
        )}
      </section>
      <div className="timeline-heading">
        <div>
          <h3>Playback timeline</h3>
          <p>Items play from top to bottom, then loop.</p>
        </div>
        {canManage && (
          <div className="editor-actions">
            <button
              className="button button--quiet"
              onClick={() => setLayoutPicker(true)}
            >
              <PanelsTopLeft size={15} />
              Add Layout
            </button>
            <button
              className="button button--primary"
              onClick={() => setPicker(true)}
            >
              <Plus size={15} />
              Add content
            </button>
          </div>
        )}
      </div>
      {(playlist.items?.length ?? 0) === 0 ? (
        <div className="timeline-empty">
          Add ready media to begin this playlist.
        </div>
      ) : (
        <div className="playlist-timeline">
          {(playlist.items ?? []).map((item, index) => (
            <TimelineItem
              key={item.id}
              item={item}
              index={index}
              canManage={canManage}
              onDragStart={() => setDragged(item.id)}
              onDrop={(e) => {
                e.preventDefault();
                void reorder(item.id);
              }}
              onChange={(input) => {
                void api
                  .updatePlaylistItem(id, item.id, input, csrf)
                  .then(update);
              }}
              onDelete={() => {
                void api.deletePlaylistItem(id, item.id, csrf).then(update);
              }}
            />
          ))}
        </div>
      )}
      {picker && (
        <ContentPicker
          open
          mode="multiple"
          csrf={csrf}
          allowedTypes={["image", "video", "widget"]}
          confirmLabel="Add to playlist"
          onConfirm={add}
          onClose={() => setPicker(false)}
        />
      )}
      <Dialog
        open={layoutPicker}
        title="Add published Layout"
        onClose={() => setLayoutPicker(false)}
      >
        <p>A Layout plays fullscreen for 30 seconds by default.</p>
        <div className="playlist-list">
          {(layouts.data?.items ?? [])
            .filter((layout) => layout.publishedRevision)
            .map((layout) => (
              <Button
                variant="quiet"
                key={layout.id}
                onClick={() => void addLayout(layout.id)}
              >
                <PanelsTopLeft size={16} aria-hidden="true" />
                {layout.name}
              </Button>
            ))}
        </div>
        {(layouts.data?.items ?? []).filter(
          (layout) => layout.publishedRevision,
        ).length === 0 && (
          <p className="status-copy">
            Publish a Layout before adding it to a playlist.
          </p>
        )}
        <div className="form-actions">
          <Button variant="quiet" onClick={() => setLayoutPicker(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function itemInput(item: PlaylistItem): PlaylistItemInput {
  return {
    assetId: item.assetId,
    layoutId: item.layoutId,
    durationMs: item.durationMs,
    fitMode: item.fitMode,
    transition: item.transition,
    audioEnabled: item.audioEnabled,
    volume: item.volume,
    videoStartOffsetMs: item.videoStartOffsetMs,
    videoEndOffsetMs: item.videoEndOffsetMs,
    deliveryPolicy: item.deliveryPolicy,
  };
}
function TimelineItem({
  item,
  index,
  canManage,
  onDragStart,
  onDrop,
  onChange,
  onDelete,
}: {
  item: PlaylistItem;
  index: number;
  canManage: boolean;
  onDragStart: () => void;
  onDrop: (e: DragEvent) => void;
  onChange: (input: PlaylistItemInput) => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof PlaylistItemInput>(
    key: K,
    value: PlaylistItemInput[K],
  ) => onChange({ ...itemInput(item), [key]: value });
  return (
    <article
      className="timeline-item"
      draggable={canManage}
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <span className="timeline-grip">
        <GripVertical size={18} />
        <b>{index + 1}</b>
      </span>
      {item.assetType === "layout" ? (
        <span className="timeline-website-icon">
          <PanelsTopLeft size={24} />
        </span>
      ) : item.assetType === "widget" ? (
        <span className="timeline-website-icon">
          <Globe2 size={24} />
        </span>
      ) : (
        <img src={item.thumbnailUrl} alt="" />
      )}
      <span className="timeline-name">
        <strong>{item.assetName}</strong>
        <small>
          {item.assetType === "image" ||
          item.assetType === "widget" ||
          item.assetType === "layout"
            ? item.durationMs
              ? `${item.durationMs / 1000} seconds`
              : "Until source ends"
            : "Full video"}
        </small>
      </span>
      <div className="timeline-item__controls">
        <label>
          Fit
          <Select
            disabled={!canManage}
            value={item.fitMode}
            onChange={(e) =>
              set("fitMode", e.target.value as PlaylistItem["fitMode"])
            }
          >
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
            <option value="stretch">Stretch</option>
          </Select>
        </label>
        <label>
          Transition
          <Select
            disabled={!canManage}
            value={item.transition}
            onChange={(e) =>
              set("transition", e.target.value as PlaylistItem["transition"])
            }
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
          </Select>
        </label>
        <label>
          Delivery
          <Select
            disabled={!canManage}
            value={item.deliveryPolicy}
            onChange={(e) =>
              set(
                "deliveryPolicy",
                e.target.value as PlaylistItem["deliveryPolicy"],
              )
            }
          >
            {item.assetType === "widget" || item.assetType === "layout" ? (
              <option value="stream">Stream</option>
            ) : (
              <>
                <option value="download">Download</option>
                <option value="stream">Stream</option>
                <option value="automatic">Automatic</option>
              </>
            )}
          </Select>
        </label>
        {item.assetType === "layout" ? (
          <label>
            Seconds
            <input
              disabled={!canManage}
              type="number"
              min="1"
              value={(item.durationMs ?? 30000) / 1000}
              onChange={(e) => set("durationMs", Number(e.target.value) * 1000)}
            />
          </label>
        ) : item.assetType === "widget" && item.widgetProvider === "youtube" ? (
          <>
            <label className="timeline-item__playback-behavior">
              Playback behavior
              <Select
                disabled={!canManage}
                value={item.durationMs == null ? "until_end" : "fixed_duration"}
                onChange={(event) =>
                  set(
                    "durationMs",
                    event.target.value === "until_end" ? undefined : 30_000,
                  )
                }
              >
                <option value="until_end">Play until video ends</option>
                <option value="fixed_duration">
                  Play for a fixed duration
                </option>
              </Select>
            </label>
            {item.durationMs != null && (
              <label>
                Seconds
                <input
                  disabled={!canManage}
                  type="number"
                  min="1"
                  value={item.durationMs / 1000}
                  onChange={(event) =>
                    set("durationMs", Number(event.target.value) * 1000)
                  }
                />
              </label>
            )}
          </>
        ) : item.assetType === "image" ||
          (item.assetType === "widget" && item.widgetProvider === "website") ? (
          <label>
            Seconds
            <input
              disabled={!canManage}
              type="number"
              min="1"
              value={(item.durationMs ?? 10000) / 1000}
              onChange={(e) => set("durationMs", Number(e.target.value) * 1000)}
            />
          </label>
        ) : (
          <>
            <label>
              Start (s)
              <input
                disabled={!canManage}
                type="number"
                min="0"
                value={(item.videoStartOffsetMs ?? 0) / 1000}
                onChange={(e) =>
                  set("videoStartOffsetMs", Number(e.target.value) * 1000)
                }
              />
            </label>
            <label>
              End (s)
              <input
                disabled={!canManage}
                type="number"
                min="0"
                value={
                  item.videoEndOffsetMs ? item.videoEndOffsetMs / 1000 : ""
                }
                onChange={(e) =>
                  set(
                    "videoEndOffsetMs",
                    e.target.value ? Number(e.target.value) * 1000 : undefined,
                  )
                }
              />
            </label>
            <label className="audio-toggle">
              <input
                disabled={!canManage}
                type="checkbox"
                checked={item.audioEnabled}
                onChange={(e) => set("audioEnabled", e.target.checked)}
              />
              Audio
            </label>
            <label>
              Volume
              <input
                disabled={!canManage}
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={item.volume}
                onChange={(e) => set("volume", Number(e.target.value))}
              />
            </label>
          </>
        )}
        {canManage && (
          <button
            className="icon-button timeline-item__remove"
            aria-label={`Remove ${item.assetName}`}
            onClick={onDelete}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
