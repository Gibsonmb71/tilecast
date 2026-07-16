import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  GripVertical,
  ListVideo,
  Plus,
  Trash2,
  Globe2,
} from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import type {
  Asset,
  Playlist,
  PlaylistItem,
  PlaylistItemInput,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  ContentPicker,
  type ContentPickerResult,
} from "../components/content-picker";

export function canManagePlaylists(role?: string) {
  return role !== "viewer";
}
export function playlistDuration(items: PlaylistItem[]) {
  return items.reduce<number | null>((total, item) => {
    const duration =
      item.assetType === "image" || item.assetType === "widget"
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
  return (
    <section className="playlists-page">
      <header className="page-heading">
        <div>
          <h2>Playlists</h2>
          <p>Ordered fullscreen playback for assigned screens.</p>
        </div>
        {canManage && (
          <button
            className="button button--primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} />
            Create playlist
          </button>
        )}
      </header>
      <label className="search-control playlist-search">
        <span className="visually-hidden">Search playlists</span>
        <input
          placeholder="Search playlists"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {query.isLoading ? (
        <div className="table-loading">Loading playlists…</div>
      ) : query.data?.items.length === 0 ? (
        <div className="content-empty">
          <ListVideo size={30} />
          <h3>No playlists yet</h3>
          <p>
            {canManage
              ? "Create a playlist, then add ready images and videos."
              : "An Owner, Administrator, or Editor can create playlists."}
          </p>
        </div>
      ) : (
        <div className="playlist-list">
          {query.data?.items.map((p) => (
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
      {creating && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-playlist-title"
          >
            <h3 id="create-playlist-title">Create playlist</h3>
            <label className="field">
              <span className="field__label">Name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {create.error && (
              <div className="notice notice--error">{create.error.message}</div>
            )}
            <div className="form-actions">
              <button
                className="button button--quiet"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Create playlist
              </button>
            </div>
          </section>
        </div>
      )}
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
  const [dragged, setDragged] = useState<string>();
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
      <header className="page-heading">
        <div>
          <Link className="back-link" to="/playlists">
            ← Playlists
          </Link>
          <h2>{playlist.name}</h2>
          <p>
            Revision {playlist.revision} ·{" "}
            {formatDuration(playlistDuration(playlist.items))}
          </p>
        </div>
        {canManage && (
          <div className="editor-actions">
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
          </div>
        )}
      </header>
      {playlist.warnings.map((w) => (
        <div key={w} className="notice notice--error">
          {w}
        </div>
      ))}
      {playlist.layoutUsage?.length > 0 && (
        <div className="notice notice--neutral">
          <strong>Used in Layouts</strong>
          <span>
            {playlist.layoutUsage.map((layout, index) => (
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
          <button
            className="button button--primary"
            onClick={() => setPicker(true)}
          >
            <Plus size={15} />
            Add content
          </button>
        )}
      </div>
      {playlist.items.length === 0 ? (
        <div className="timeline-empty">
          Add ready media to begin this playlist.
        </div>
      ) : (
        <div className="playlist-timeline">
          {playlist.items.map((item, index) => (
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
    </section>
  );
}

function itemInput(item: PlaylistItem): PlaylistItemInput {
  return {
    assetId: item.assetId,
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
      {item.assetType === "widget" ? (
        <span className="timeline-website-icon">
          <Globe2 size={24} />
        </span>
      ) : (
        <img src={item.thumbnailUrl} alt="" />
      )}
      <span className="timeline-name">
        <strong>{item.assetName}</strong>
        <small>
          {item.assetType === "image" || item.assetType === "widget"
            ? item.durationMs
              ? `${item.durationMs / 1000} seconds`
              : "Until source ends"
            : "Full video"}
        </small>
      </span>
      <label>
        Fit
        <select
          disabled={!canManage}
          value={item.fitMode}
          onChange={(e) =>
            set("fitMode", e.target.value as PlaylistItem["fitMode"])
          }
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="stretch">Stretch</option>
        </select>
      </label>
      <label>
        Transition
        <select
          disabled={!canManage}
          value={item.transition}
          onChange={(e) =>
            set("transition", e.target.value as PlaylistItem["transition"])
          }
        >
          <option value="none">None</option>
          <option value="fade">Fade</option>
        </select>
      </label>
      <label>
        Delivery
        <select
          disabled={!canManage}
          value={item.deliveryPolicy}
          onChange={(e) =>
            set(
              "deliveryPolicy",
              e.target.value as PlaylistItem["deliveryPolicy"],
            )
          }
        >
          {item.assetType === "widget" ? (
            <option value="stream">Stream</option>
          ) : (
            <>
              <option value="download">Download</option>
              <option value="stream">Stream</option>
              <option value="automatic">Automatic</option>
            </>
          )}
        </select>
      </label>
      {item.assetType === "widget" && item.widgetProvider === "youtube" ? (
        <>
          <label>
            Playback behavior
            <select
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
              <option value="fixed_duration">Play for a fixed duration</option>
            </select>
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
              value={item.videoEndOffsetMs ? item.videoEndOffsetMs / 1000 : ""}
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
          className="icon-button"
          aria-label={`Remove ${item.assetName}`}
          onClick={onDelete}
        >
          <Trash2 size={16} />
        </button>
      )}
    </article>
  );
}
