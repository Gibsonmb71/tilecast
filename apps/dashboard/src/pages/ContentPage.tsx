import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileImage,
  FileVideo,
  Grid2X2,
  List,
  Search,
  Upload,
  Globe2,
  Copy,
  Trash2,
  Youtube,
  X,
  CalendarDays,
  FolderPlus,
  Tags,
  Library,
} from "lucide-react";
import { signalColors } from "@tilecast/design-tokens/values";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { api, ApiError } from "../api/client";
import type {
  Asset,
  AssetStatus,
  User,
  WebsiteInput,
  YouTubeConfig,
  ContentFolder,
  ContentCollection,
  ContentTag,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  CalendarSourceEditor,
  StructuredSourceEditor,
  NativeAppEditor,
  YouTubeSourceEditor,
} from "../content/SourceEditors";

type QueueItem = {
  localId: string;
  sessionId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBytes: number;
  state: "waiting" | "uploading" | "finalizing" | "processing" | "failed";
  error?: string;
};

type SavedUpload = Pick<
  QueueItem,
  "sessionId" | "filename" | "mimeType" | "sizeBytes" | "uploadedBytes"
>;

const resumeKey = "tilecast.resumable-uploads.v1";
const chunkSize = 5 * 1024 * 1024;

export function canManageContent(user?: User) {
  return user?.role !== "viewer";
}

export function statusLabel(status: AssetStatus) {
  return (
    {
      uploading: "Uploading",
      uploaded: "Uploaded",
      queued: "Waiting",
      inspecting: "Inspecting",
      processing: "Processing",
      ready: "Ready",
      failed: "Failed",
      deleting: "Deleting",
      deleted: "Deleted",
    } satisfies Record<AssetStatus, string>
  )[status];
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(seconds?: number) {
  if (seconds == null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function ContentPage() {
  const auth = useAuth();
  const canManage = canManageContent(auth.status?.user);
  const csrf = auth.status?.csrfToken ?? "";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [contentFilter, setContentFilter] = useState("media");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("updated");
  const [folderFilter, setFolderFilter] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [checkedAssetIds, setCheckedAssetIds] = useState<Set<string>>(
    new Set(),
  );
  const [view, setView] = useState<"grid" | "list">("grid");
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(resumeKey) ?? "[]",
      ) as SavedUpload[];
      return saved.map((item) => ({
        ...item,
        localId: item.sessionId ?? crypto.randomUUID(),
        state: "failed",
        error: "Select the same file to resume this upload.",
      }));
    } catch {
      return [];
    }
  });
  const [selected, setSelected] = useState<Asset>();
  const controllers = useRef(new Map<string, AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const params = new URLSearchParams({ page: "1", pageSize: "48", sort });
  if (search) params.set("search", search);
  if (["media", "image", "video"].includes(contentFilter))
    params.set("type", contentFilter);
  if (status) params.set("status", status);
  if (folderFilter) params.set("folderId", folderFilter);
  if (collectionFilter) params.set("collectionId", collectionFilter);
  if (tagFilter) params.set("tagId", tagFilter);
  const assets = useQuery({
    queryKey: ["assets", params.toString()],
    queryFn: () => api.assets(params),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "inspecting", "processing"].includes(item.processingStatus),
      )
        ? 3000
        : false,
  });
  const folders = useQuery({
    queryKey: ["content-folders"],
    queryFn: api.contentFolders,
  });
  const collections = useQuery({
    queryKey: ["content-collections"],
    queryFn: api.contentCollections,
  });
  const tags = useQuery({
    queryKey: ["content-tags"],
    queryFn: api.contentTags,
  });

  useEffect(() => {
    const saved = queue
      .filter((item) => item.sessionId && item.state !== "processing")
      .map(({ sessionId, filename, mimeType, sizeBytes, uploadedBytes }) => ({
        sessionId,
        filename,
        mimeType,
        sizeBytes,
        uploadedBytes,
      }));
    localStorage.setItem(resumeKey, JSON.stringify(saved));
  }, [queue]);

  const updateQueue = (localId: string, update: Partial<QueueItem>) =>
    setQueue((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, ...update } : item,
      ),
    );

  const uploadFile = async (file: File, resume?: QueueItem) => {
    const localId = resume?.localId ?? crypto.randomUUID();
    if (
      resume &&
      (file.name !== resume.filename || file.size !== resume.sizeBytes)
    ) {
      updateQueue(localId, {
        error: "Choose the original file with the same name and size.",
      });
      return;
    }
    let sessionId = resume?.sessionId;
    let offset = 0;
    const item: QueueItem = resume ?? {
      localId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      uploadedBytes: 0,
      state: "waiting",
    };
    if (!resume) setQueue((current) => [...current, item]);
    const controller = new AbortController();
    controllers.current.set(localId, controller);
    try {
      if (sessionId) {
        const state = await api.inspectUpload(sessionId);
        offset = state.offset;
      } else {
        const created = await api.createUpload(
          {
            filename: file.name,
            mimeType: item.mimeType,
            sizeBytes: file.size,
          },
          csrf,
        );
        sessionId = created.id;
        offset = created.offset;
      }
      updateQueue(localId, {
        sessionId,
        uploadedBytes: offset,
        state: "uploading",
        error: undefined,
      });
      while (offset < file.size) {
        const next = Math.min(file.size, offset + chunkSize);
        offset = await api.uploadChunk(
          sessionId,
          offset,
          file.slice(offset, next),
          csrf,
          controller.signal,
        );
        updateQueue(localId, { uploadedBytes: offset });
      }
      updateQueue(localId, { state: "finalizing" });
      await api.completeUpload(sessionId, csrf);
      updateQueue(localId, { state: "processing", uploadedBytes: file.size });
      await queryClient.invalidateQueries({ queryKey: ["assets"] });
      window.setTimeout(
        () =>
          setQueue((current) =>
            current.filter((queued) => queued.localId !== localId),
          ),
        1500,
      );
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        updateQueue(localId, {
          state: "failed",
          error: error instanceof Error ? error.message : "Upload failed.",
        });
    } finally {
      controllers.current.delete(localId);
    }
  };

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(event.target.files ?? []))
      void uploadFile(file);
    event.target.value = "";
  };
  const dropFiles = (event: DragEvent) => {
    event.preventDefault();
    if (canManage)
      for (const file of Array.from(event.dataTransfer.files))
        void uploadFile(file);
  };
  const cancel = async (item: QueueItem) => {
    controllers.current.get(item.localId)?.abort();
    if (item.sessionId)
      await api.cancelUpload(item.sessionId, csrf).catch(() => undefined);
    setQueue((current) =>
      current.filter((queued) => queued.localId !== item.localId),
    );
  };
  const resume = (item: QueueItem) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadFile(file, item);
    };
    input.click();
  };

  return (
    <section
      className="content-page"
      onDragOver={(event) => event.preventDefault()}
      onDrop={dropFiles}
    >
      <header className="page-heading">
        <div>
          <h2>Assets</h2>
          <p>Uploaded images and videos available to playlists and Layouts.</p>
        </div>
        {canManage && (
          <button
            className="button button--primary"
            type="button"
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={16} /> Upload assets
          </button>
        )}
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska"
          onChange={pickFiles}
          aria-label="Choose media files"
        />
      </header>

      {queue.length > 0 && (
        <section className="upload-queue" aria-label="Upload queue">
          <header>
            <strong>Uploads</strong>
            <span>{queue.length} active</span>
          </header>
          {queue.map((item) => {
            const percent = Math.round(
              (item.uploadedBytes / item.sizeBytes) * 100,
            );
            return (
              <div className="upload-row" key={item.localId}>
                <span>
                  <strong>{item.filename}</strong>
                  <small>
                    {formatBytes(item.uploadedBytes)} of{" "}
                    {formatBytes(item.sizeBytes)} · {item.state}
                  </small>
                  {item.error && (
                    <small className="upload-error">{item.error}</small>
                  )}
                </span>
                <progress value={item.uploadedBytes} max={item.sizeBytes}>
                  {percent}%
                </progress>
                <b>{percent}%</b>
                {item.state === "failed" && (
                  <button
                    className="button button--quiet"
                    onClick={() => resume(item)}
                  >
                    Retry or resume
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Cancel ${item.filename}`}
                  onClick={() => void cancel(item)}
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </section>
      )}

      <div className="content-toolbar">
        <label className="search-control">
          <Search size={15} />
          <span className="visually-hidden">Search media</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search media"
          />
        </label>
        <div className="content-type-filters" aria-label="Content type filters">
          {(
            [
              ["media", "Media"],
              ["image", "Images"],
              ["video", "Videos"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={contentFilter === value}
              onClick={() => setContentFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="ready">Ready</option>
          <option value="queued">Waiting</option>
          <option value="inspecting">Inspecting</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
        </select>
        <select
          aria-label="Filter by folder"
          value={folderFilter}
          onChange={(event) => setFolderFilter(event.target.value)}
        >
          <option value="">All folders</option>
          {folders.data?.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name} ({folder.assetCount})
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by collection"
          value={collectionFilter}
          onChange={(event) => setCollectionFilter(event.target.value)}
        >
          <option value="">All collections</option>
          {collections.data?.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name} ({collection.assetCount})
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by tag"
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
        >
          <option value="">All tags</option>
          {tags.data?.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name} ({tag.assetCount ?? 0})
            </option>
          ))}
        </select>
        <select
          aria-label="Sort media"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="updated">Recently updated</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
        </select>
        <span className="view-switch" aria-label="View">
          <button
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={16} />
          </button>
          <button
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={16} />
          </button>
        </span>
      </div>

      {canManage && (
        <ContentOrganizer
          csrf={csrf}
          folders={folders.data ?? []}
          collections={collections.data ?? []}
          tags={tags.data ?? []}
          assetIds={[...checkedAssetIds]}
          onChanged={() => {
            setCheckedAssetIds(new Set());
            void queryClient.invalidateQueries({ queryKey: ["assets"] });
            void queryClient.invalidateQueries({
              queryKey: ["content-folders"],
            });
            void queryClient.invalidateQueries({
              queryKey: ["content-collections"],
            });
            void queryClient.invalidateQueries({ queryKey: ["content-tags"] });
          }}
        />
      )}

      {assets.isError && (
        <div className="notice notice--error">
          {assets.error instanceof ApiError
            ? assets.error.message
            : "The media library could not be loaded."}
        </div>
      )}
      {assets.isLoading ? (
        <div className="table-loading">Loading media…</div>
      ) : assets.data?.items.length === 0 ? (
        <ContentEmpty
          canManage={canManage}
          onChoose={() => fileInput.current?.click()}
          onDrop={dropFiles}
        />
      ) : (
        <AssetCollection
          items={assets.data?.items ?? []}
          view={view}
          onSelect={(asset) => void api.asset(asset.id).then(setSelected)}
          canManage={canManage}
          onDuplicate={(asset) =>
            void api
              .duplicateSource(asset.id, csrf)
              .then(() =>
                queryClient.invalidateQueries({ queryKey: ["assets"] }),
              )
          }
          onDelete={(asset) => {
            if (confirm(`Delete ${asset.name}?`))
              void api
                .deleteAsset(asset.id, csrf)
                .then(() =>
                  queryClient.invalidateQueries({ queryKey: ["assets"] }),
                );
          }}
          selectedIds={checkedAssetIds}
          onToggle={(id) =>
            setCheckedAssetIds((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      )}
      {selected && (
        <AssetDetails
          asset={selected}
          canManage={canManage}
          csrf={csrf}
          onClose={() => setSelected(undefined)}
          onChanged={(asset) => {
            setSelected(asset);
            void queryClient.invalidateQueries({ queryKey: ["assets"] });
          }}
        />
      )}
    </section>
  );
}

export function ContentEmpty({
  canManage,
  onChoose,
  onDrop,
}: {
  canManage: boolean;
  onChoose: () => void;
  onDrop?: (event: DragEvent) => void;
}) {
  return (
    <div
      className="content-empty"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <FileImage size={30} />
      <h3>No media yet</h3>
      <p>
        {canManage
          ? "Drag images or videos here, or choose files to begin your library."
          : "An Owner, Administrator, or Editor can upload media."}
      </p>
      {canManage && (
        <button className="button button--quiet" onClick={onChoose}>
          Choose files
        </button>
      )}
    </div>
  );
}

export function AssetCollection({
  items,
  view,
  onSelect,
  canManage = false,
  onDuplicate,
  onDelete,
  selectedIds = new Set(),
  onToggle,
}: {
  items: Asset[];
  view: "grid" | "list";
  onSelect: (asset: Asset) => void;
  canManage?: boolean;
  onDuplicate?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
}) {
  return (
    <div className={`asset-collection asset-collection--${view}`}>
      {items.map((asset) => (
        <article className="asset-card" key={asset.id}>
          {canManage && onToggle && (
            <label className="asset-card__select">
              <input
                type="checkbox"
                checked={selectedIds.has(asset.id)}
                onChange={() => onToggle(asset.id)}
              />
              <span className="visually-hidden">Select {asset.name}</span>
            </label>
          )}
          <button
            className="asset-card__open"
            onClick={() => onSelect(asset)}
            aria-label={`Edit ${asset.name}`}
          >
            <span className="asset-preview">
              {asset.source?.provider === "youtube" &&
              typeof (asset.source.configuration as YouTubeConfig).videoId ===
                "string" ? (
                <img
                  src={`https://i.ytimg.com/vi/${(asset.source.configuration as YouTubeConfig).videoId}/hqdefault.jpg`}
                  alt=""
                  referrerPolicy="origin"
                />
              ) : asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt="" />
              ) : asset.type === "video" ? (
                <FileVideo size={28} />
              ) : asset.type === "source" ? (
                asset.source?.provider === "youtube" ? (
                  <Youtube size={28} />
                ) : asset.source?.provider === "calendar" ? (
                  <CalendarDays size={28} />
                ) : ["rss", "atom", "json", "csv"].includes(
                    asset.source?.provider ?? "",
                  ) ? (
                  <Library size={28} />
                ) : (
                  <Globe2 size={28} />
                )
              ) : (
                <FileImage size={28} />
              )}
            </span>
            <span className="asset-card__body">
              <strong>{asset.name}</strong>
              <small>
                {asset.type === "video" &&
                  formatDuration(asset.durationSeconds)}
                {asset.type === "source" &&
                  (asset.source?.provider === "youtube"
                    ? "YouTube"
                    : asset.source?.provider === "calendar"
                      ? "Calendar"
                      : asset.source?.provider
                        ? asset.source.provider.toUpperCase()
                        : asset.website?.displayUrl)}
                {asset.width && asset.height
                  ? `${asset.type === "video" ? " · " : ""}${asset.width} × ${asset.height}`
                  : ""}
              </small>
              <small>{formatBytes(asset.originalSize)}</small>
            </span>
            <span
              className={`media-status media-status--${asset.processingStatus}`}
            >
              {statusLabel(asset.processingStatus)}
            </span>
          </button>
          {asset.type === "source" && (
            <footer className="source-card-actions">
              <span>
                {asset.playlistUsage ?? 0} playlist
                {asset.playlistUsage === 1 ? "" : "s"}
                {` · ${asset.layoutUsage?.length ?? 0} Layout${asset.layoutUsage?.length === 1 ? "" : "s"}`}
              </span>
              {canManage && (
                <>
                  <button type="button" onClick={() => onSelect(asset)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicate?.(asset)}
                    aria-label={`Duplicate ${asset.name}`}
                  >
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete?.(asset)}
                    aria-label={`Delete ${asset.name}`}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </>
              )}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

function ContentOrganizer({
  csrf,
  folders,
  collections,
  tags,
  assetIds,
  onChanged,
}: {
  csrf: string;
  folders: ContentFolder[];
  collections: ContentCollection[];
  tags: ContentTag[];
  assetIds: string[];
  onChanged: () => void;
}) {
  const [folderId, setFolderId] = useState("");
  const [tagId, setTagId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [error, setError] = useState("");
  const createFolder = async () => {
    const name = prompt("Folder name");
    if (!name) return;
    await api.createContentFolder({ name, description: "" }, csrf);
    onChanged();
  };
  const createCollection = async () => {
    const name = prompt("Collection name");
    if (!name) return;
    await api.createContentCollection({ name, description: "" }, csrf);
    onChanged();
  };
  const createTag = async () => {
    const name = prompt("Tag name");
    if (!name) return;
    await api.createContentTag({ name, color: "#64748b" }, csrf);
    onChanged();
  };
  const apply = async () => {
    if (!assetIds.length) return;
    setError("");
    try {
      const [tagAction, selectedTagId] = tagId.split(":");
      const [collectionAction, selectedCollectionId] = collectionId.split(":");
      await api.bulkOrganize(
        {
          assetIds,
          ...(folderId
            ? {
                setFolder: true,
                ...(folderId === "unfiled" ? {} : { folderId }),
              }
            : {}),
          ...(selectedTagId
            ? tagAction === "remove"
              ? { removeTagIds: [selectedTagId] }
              : { addTagIds: [selectedTagId] }
            : {}),
          ...(selectedCollectionId
            ? collectionAction === "remove"
              ? { removeCollectionIds: [selectedCollectionId] }
              : { addCollectionIds: [selectedCollectionId] }
            : {}),
        },
        csrf,
      );
      setFolderId("");
      setTagId("");
      setCollectionId("");
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Content could not be organized.",
      );
    }
  };
  return (
    <div className="content-organizer" aria-label="Content organization">
      <div className="content-organizer__create">
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void createFolder()}
        >
          <FolderPlus size={15} /> Folder
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void createCollection()}
        >
          <Library size={15} /> Collection
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void createTag()}
        >
          <Tags size={15} /> Tag
        </button>
      </div>
      {assetIds.length > 0 && (
        <div className="content-organizer__bulk">
          <strong>{assetIds.length} selected</strong>
          <select
            aria-label="Move selected content to folder"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">Folder…</option>
            <option value="unfiled">Unfiled</option>
            {folders.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Tag selected content"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
          >
            <option value="">Add tag…</option>
            {tags.map((v) => (
              <option key={`add-${v.id}`} value={`add:${v.id}`}>
                Add {v.name}
              </option>
            ))}
            {tags.map((v) => (
              <option key={`remove-${v.id}`} value={`remove:${v.id}`}>
                Remove {v.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Add selected content to collection"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
          >
            <option value="">Collection…</option>
            {collections.map((v) => (
              <option key={`add-${v.id}`} value={`add:${v.id}`}>
                Add to {v.name}
              </option>
            ))}
            {collections.map((v) => (
              <option key={`remove-${v.id}`} value={`remove:${v.id}`}>
                Remove from {v.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button button--primary"
            disabled={!folderId && !tagId && !collectionId}
            onClick={() => void apply()}
          >
            Apply
          </button>
        </div>
      )}
      {error && <span className="notice notice--error">{error}</span>}
    </div>
  );
}

function AssetDetails(props: {
  asset: Asset;
  canManage: boolean;
  csrf: string;
  onClose: () => void;
  onChanged: (asset: Asset) => void;
}) {
  return props.asset.type === "source" &&
    props.asset.source?.provider === "website" ? (
    <WebsiteEditor
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "source" &&
    props.asset.source?.provider === "youtube" ? (
    <YouTubeSourceEditor
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "source" &&
    props.asset.source?.provider === "calendar" ? (
    <CalendarSourceEditor
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "source" &&
    props.asset.source &&
    ["rss", "atom", "json", "csv"].includes(props.asset.source.provider) ? (
    <StructuredSourceEditor
      provider={props.asset.source.provider as "rss" | "atom" | "json" | "csv"}
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "source" &&
    props.asset.source &&
    [
      "clock",
      "date",
      "qrcode",
      "ticker",
      "menu",
      "list",
      "table",
      "agenda",
    ].includes(props.asset.source.provider) ? (
    <NativeAppEditor
      provider={
        props.asset.source.provider as
          | "clock"
          | "date"
          | "qrcode"
          | "ticker"
          | "menu"
          | "list"
          | "table"
          | "agenda"
      }
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : (
    <MediaAssetDetails {...props} />
  );
}
function MediaAssetDetails({
  asset,
  canManage,
  csrf,
  onClose,
  onChanged,
}: {
  asset: Asset;
  canManage: boolean;
  csrf: string;
  onClose: () => void;
  onChanged: (asset: Asset) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.description);
  const mutation = useMutation({
    mutationFn: () => api.updateAsset(asset.id, { name, description }, csrf),
    onSuccess: onChanged,
  });
  return (
    <div
      className="details-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="asset-details"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-details-title"
      >
        <header>
          <h2 id="asset-details-title">Asset details</h2>
          <button
            className="icon-button"
            aria-label="Close details"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {asset.thumbnailUrl && (
          <img className="details-preview" src={asset.thumbnailUrl} alt="" />
        )}
        <label className="field">
          <span className="field__label">Name</span>
          <input
            value={name}
            disabled={!canManage}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            value={description}
            disabled={!canManage}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{statusLabel(asset.processingStatus)}</dd>
          </div>
          <div>
            <dt>Original file</dt>
            <dd>{asset.originalFilename}</dd>
          </div>
          <div>
            <dt>Detected type</dt>
            <dd>{asset.detectedMimeType}</dd>
          </div>
          <div>
            <dt>SHA-256</dt>
            <dd className="hash">{asset.sha256}</dd>
          </div>
        </dl>
        {asset.layoutUsage?.length ? (
          <section className="content-usage-list">
            <h3>Used in Layouts</h3>
            {asset.layoutUsage.map((usage) => (
              <a key={usage.id} href={`/layouts/${usage.id}`}>
                <span>{usage.name}</span>
                <small>{usage.published ? "Published" : "Draft"}</small>
              </a>
            ))}
          </section>
        ) : null}
        {asset.errorMessage && (
          <div className="notice notice--error">{asset.errorMessage}</div>
        )}
        {canManage && (
          <footer>
            <button
              className="button button--primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Save changes
            </button>
            {asset.processingStatus === "failed" && (
              <button
                className="button button--quiet"
                onClick={() =>
                  void api.retryAsset(asset.id, csrf).then(onChanged)
                }
              >
                Retry processing
              </button>
            )}
            <button
              className="button button--danger"
              onClick={() => {
                if (window.confirm(`Delete ${asset.name}?`))
                  void api.deleteAsset(asset.id, csrf).then(onClose);
              }}
            >
              Delete asset
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

const defaultWebsite: WebsiteInput = {
  name: "",
  description: "",
  url: "https://",
  allowedHosts: [],
  javascriptEnabled: true,
  domStorageEnabled: true,
  cookiePolicy: "first_party",
  reloadPolicy: "on_each_activation",
  loadTimeoutSeconds: 20,
  zoomPercent: 100,
  scrollX: 0,
  scrollY: 0,
  customUserAgent: "",
  backgroundColor: signalColors.playerBackground,
  failureBehavior: "placeholder",
};
export function WebsiteEditor({
  asset,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
  page = false,
}: {
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  page?: boolean;
}) {
  const initial: WebsiteInput = asset?.website
    ? {
        name: asset.name,
        description: asset.description,
        url: asset.website.url,
        allowedHosts: asset.website.allowedHosts,
        javascriptEnabled: asset.website.javascriptEnabled,
        domStorageEnabled: asset.website.domStorageEnabled,
        cookiePolicy: asset.website.cookiePolicy,
        reloadPolicy: asset.website.reloadPolicy,
        refreshIntervalSeconds: asset.website.refreshIntervalSeconds,
        loadTimeoutSeconds: asset.website.loadTimeoutSeconds,
        zoomPercent: asset.website.zoomPercent,
        scrollX: asset.website.scrollX,
        scrollY: asset.website.scrollY,
        customUserAgent: asset.website.customUserAgent,
        backgroundColor: asset.website.backgroundColor,
        failureBehavior: asset.website.failureBehavior,
        fallbackImageAssetId: asset.website.fallbackImageAssetId,
      }
    : defaultWebsite;
  const [input, setInput] = useState(initial),
    [dirty, setDirty] = useState(false);
  const set = <K extends keyof WebsiteInput>(
    key: K,
    value: WebsiteInput[K],
  ) => {
    setInput((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    addEventListener("beforeunload", handler);
    return () => removeEventListener("beforeunload", handler);
  }, [dirty]);
  const images = useQuery({
    queryKey: ["assets", "website-fallbacks"],
    queryFn: () =>
      api.assets(
        new URLSearchParams({
          page: "1",
          pageSize: "100",
          type: "image",
          status: "ready",
        }),
      ),
  });
  const diagnostics = useQuery({
    queryKey: ["assets", asset?.id, "website-diagnostics"],
    queryFn: () => api.websiteDiagnostics(asset!.id),
    enabled: !!asset,
  });
  const save = useMutation({
    mutationFn: () => {
      const { name, description, ...configuration } = input;
      const sourceInput = {
        provider: "website" as const,
        name,
        description,
        configuration,
      };
      return asset
        ? api.updateSource(asset.id, sourceInput, csrf)
        : api.createSource(sourceInput, csrf);
    },
    onSuccess: (value) => {
      setDirty(false);
      onSaved(value);
    },
  });
  const close = () => {
    if (!dirty || confirm("Discard unsaved website changes?")) onClose();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!dirty || confirm("Discard unsaved website changes?")) onClose();
      }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [dirty, onClose]);
  return (
    <div
      className="details-backdrop"
      role={page ? undefined : "presentation"}
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (!dirty || confirm("Discard unsaved website changes?"))
        )
          onClose();
      }}
    >
      <section
        className="asset-details website-editor"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
      >
        <header>
          <div>
            <h2>{asset ? "Edit Website App" : "Create Website App"}</h2>
            <p>
              Fullscreen public website content. Duration is configured in the
              playlist.
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={close}>
            <X size={18} />
          </button>
        </header>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            disabled={readOnly}
            value={input.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            disabled={readOnly}
            value={input.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">HTTPS URL</span>
          <input
            disabled={readOnly}
            value={input.url}
            onChange={(e) => set("url", e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Reload policy</span>
          <select
            disabled={readOnly}
            value={input.reloadPolicy}
            onChange={(e) =>
              set(
                "reloadPolicy",
                e.target.value as WebsiteInput["reloadPolicy"],
              )
            }
          >
            <option value="load_once">Load once while active</option>
            <option value="on_each_activation">
              Reload on each activation
            </option>
            <option value="interval">Reload on interval</option>
          </select>
        </label>
        {input.reloadPolicy === "interval" && (
          <label className="field">
            <span className="field__label">Refresh interval (seconds)</span>
            <input
              disabled={readOnly}
              type="number"
              min={30}
              value={input.refreshIntervalSeconds ?? 30}
              onChange={(e) =>
                set("refreshIntervalSeconds", Number(e.target.value))
              }
            />
          </label>
        )}
        <label className="field">
          <span className="field__label">Failure behavior</span>
          <select
            disabled={readOnly}
            value={input.failureBehavior}
            onChange={(e) =>
              set(
                "failureBehavior",
                e.target.value as WebsiteInput["failureBehavior"],
              )
            }
          >
            <option value="placeholder">Show Tilecast placeholder</option>
            <option value="last_success">Keep last rendered page</option>
            <option value="fallback_image">Show fallback image</option>
            <option value="skip">Skip item</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Fallback image</span>
          <select
            disabled={readOnly}
            value={input.fallbackImageAssetId ?? ""}
            onChange={(e) =>
              set("fallbackImageAssetId", e.target.value || undefined)
            }
          >
            <option value="">None</option>
            {images.data?.items.map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Advanced website settings</summary>
          <label className="field">
            <span className="field__label">
              Allowed top-level hosts (comma separated)
            </span>
            <input
              disabled={readOnly}
              value={input.allowedHosts.join(", ")}
              onChange={(e) =>
                set(
                  "allowedHosts",
                  e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
            />
            <small>
              The URL host is always added. This restricts top-level navigation,
              not all third-party subresources.
            </small>
          </label>
          <label>
            <input
              disabled={readOnly}
              type="checkbox"
              checked={input.javascriptEnabled}
              onChange={(e) => set("javascriptEnabled", e.target.checked)}
            />{" "}
            JavaScript enabled
          </label>
          <label>
            <input
              disabled={readOnly}
              type="checkbox"
              checked={input.domStorageEnabled}
              onChange={(e) => set("domStorageEnabled", e.target.checked)}
            />{" "}
            DOM storage enabled
          </label>
          <label className="field">
            <span className="field__label">Cookies</span>
            <select
              disabled={readOnly}
              value={input.cookiePolicy}
              onChange={(e) =>
                set(
                  "cookiePolicy",
                  e.target.value as WebsiteInput["cookiePolicy"],
                )
              }
            >
              <option value="disabled">Disabled</option>
              <option value="first_party">First-party only</option>
              <option value="first_and_third_party">
                First- and third-party
              </option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Load timeout (seconds)</span>
            <input
              disabled={readOnly}
              type="number"
              min={1}
              max={120}
              value={input.loadTimeoutSeconds}
              onChange={(e) =>
                set("loadTimeoutSeconds", Number(e.target.value))
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Zoom percentage</span>
            <input
              disabled={readOnly}
              type="number"
              min={50}
              max={200}
              value={input.zoomPercent}
              onChange={(e) => set("zoomPercent", Number(e.target.value))}
            />
          </label>
          <div className="website-position">
            <label className="field">
              <span className="field__label">Horizontal scroll</span>
              <input
                disabled={readOnly}
                type="number"
                min={0}
                value={input.scrollX}
                onChange={(e) => set("scrollX", Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span className="field__label">Vertical scroll</span>
              <input
                disabled={readOnly}
                type="number"
                min={0}
                value={input.scrollY}
                onChange={(e) => set("scrollY", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Custom user agent</span>
            <input
              disabled={readOnly}
              maxLength={512}
              value={input.customUserAgent}
              onChange={(e) => set("customUserAgent", e.target.value)}
            />
            <small>
              Leave blank for Android WebView’s standard user agent. Overrides
              can break sites.
            </small>
          </label>
        </details>
        {diagnostics.data && (
          <section className="website-diagnostics">
            <h3>Player diagnostics</h3>
            <p>Allowed hosts: {diagnostics.data.allowedHosts.join(", ")}</p>
            <p>
              Last successful load:{" "}
              {diagnostics.data.lastSuccessfulLoad
                ? new Date(diagnostics.data.lastSuccessfulLoad).toLocaleString()
                : "Not reported"}
            </p>
            <p>
              Last failure:{" "}
              {diagnostics.data.lastFailureCategory ?? "Not reported"}
            </p>
            <p>
              Reporting screens:{" "}
              {diagnostics.data.reportingScreens
                .map((screen) => `${screen.name} (${screen.state})`)
                .join(", ") || "None"}
            </p>
          </section>
        )}
        {save.error && (
          <div className="notice notice--error">{save.error.message}</div>
        )}
        <footer>
          {!readOnly && (
            <button
              className="button button--primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              Save website
            </button>
          )}
          <button className="button button--quiet" onClick={close}>
            Cancel
          </button>
          {asset && !readOnly && (
            <button
              className="button button--danger"
              onClick={() => {
                if (confirm(`Delete ${asset.name}?`))
                  void api.deleteAsset(asset.id, csrf).then(onClose);
              }}
            >
              Delete website
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
