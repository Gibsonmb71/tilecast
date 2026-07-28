import {
  Button,
  ContextMenu,
  Dialog,
  Drawer,
  Notice,
  PageHeader,
  Select,
  ToggleGroup,
  ViewToggle,
  useContextMenu,
  type ContextMenuItem,
} from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EllipsisVertical,
  FileImage,
  Folder,
  Upload,
  Copy,
  Pencil,
  Square,
  SquareCheck,
  SquarePen,
  Trash2,
  X,
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
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";
import type {
  Asset,
  AssetStatus,
  BulkOrganizeInput,
  User,
  WebsiteInput,
  ContentFolder,
  ContentCollection,
  ContentTag,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { NativeAppEditor, YouTubeSourceEditor } from "../content/SourceEditors";
import { AssetPreview } from "../components/content/AssetPreview";
import { droppedFiles } from "../components/content/dragDrop";
import { UsedByPanel } from "../content/UsedByPanel";
import { WorkspaceTabs, contentTabs } from "../navigation/WorkspaceTabs";

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
  return Boolean(user && user.role !== "viewer");
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
      query.state.data?.items?.some((item) =>
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
  const refreshOrganization = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["content-folders"] });
    void queryClient.invalidateQueries({ queryKey: ["content-collections"] });
    void queryClient.invalidateQueries({ queryKey: ["content-tags"] });
  };

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
    let offset: number;
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
      for (const file of droppedFiles(event.dataTransfer))
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
      <WorkspaceTabs label="Content library" tabs={contentTabs} />
      <PageHeader
        title="Media"
        description="Uploaded images and videos available to playlists and Layouts."
        actions={
          canManage ? (
            <Button
              variant="primary"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} aria-hidden="true" /> Upload assets
            </Button>
          ) : undefined
        }
      />
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,video/x-matroska"
        onChange={pickFiles}
        aria-label="Choose media files"
      />

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

      <DashboardListToolbar className="content-toolbar dashboard-list-toolbar--dense">
        <DashboardSearch
          value={search}
          onValueChange={setSearch}
          label="Search media"
          placeholder="Search media"
        />
        <ToggleGroup
          className="content-type-filters"
          label="Content type filters"
          value={contentFilter}
          onValueChange={setContentFilter}
          items={[
            { value: "media", label: "Media" },
            { value: "image", label: "Images" },
            { value: "video", label: "Videos" },
          ]}
        />
        <Select
          className="dashboard-list-toolbar__filter"
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
        </Select>
        <Select
          className="dashboard-list-toolbar__filter"
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
        </Select>
        <Select
          className="dashboard-list-toolbar__filter"
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
        </Select>
        <Select
          className="dashboard-list-toolbar__filter"
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
        </Select>
        <Select
          className="dashboard-list-toolbar__filter"
          aria-label="Sort media"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="updated">Recently updated</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
        </Select>
        <ViewToggle value={view} onValueChange={setView} />
      </DashboardListToolbar>

      {canManage && (
        <ContentOrganizer
          csrf={csrf}
          folders={folders.data ?? []}
          collections={collections.data ?? []}
          tags={tags.data ?? []}
          assetIds={[...checkedAssetIds]}
          onApplied={() => {
            setCheckedAssetIds(new Set());
            refreshOrganization();
          }}
          onCatalogChanged={refreshOrganization}
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
      ) : assets.data?.items?.length === 0 ? (
        <ContentEmpty
          canManage={canManage}
          onChoose={() => fileInput.current?.click()}
          onDrop={dropFiles}
        />
      ) : (
        <AssetCollection
          items={assets.data?.items ?? []}
          view={view}
          folderNames={
            new Map(
              (folders.data ?? []).map((folder) => [folder.id, folder.name]),
            )
          }
          onSelect={(asset) => void api.asset(asset.id).then(setSelected)}
          canManage={canManage}
          onDuplicate={(asset) =>
            void api
              .duplicateWidget(asset.id, csrf)
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
  folderNames,
}: {
  items: Asset[];
  view: "grid" | "list";
  onSelect: (asset: Asset) => void;
  canManage?: boolean;
  onDuplicate?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  folderNames?: Map<string, string>;
}) {
  const menu = useContextMenu<Asset>();
  // Every action is also reachable from a visible control, so the menu stays a shortcut
  // rather than the only route to duplication or deletion.
  const actionsFor = (asset: Asset): ContextMenuItem[] => {
    const actions: ContextMenuItem[] = [
      {
        label: canManage ? "Edit" : "Open",
        icon: <SquarePen size={14} />,
        onSelect: () => onSelect(asset),
      },
    ];
    if (canManage && onToggle)
      actions.push({
        label: selectedIds.has(asset.id) ? "Clear selection" : "Select",
        icon: selectedIds.has(asset.id) ? (
          <Square size={14} />
        ) : (
          <SquareCheck size={14} />
        ),
        onSelect: () => onToggle(asset.id),
      });
    // Only Widgets have a duplicate endpoint; uploaded media has no server-side copy.
    if (canManage && onDuplicate && asset.type === "widget")
      actions.push({
        label: "Duplicate",
        icon: <Copy size={14} />,
        onSelect: () => onDuplicate(asset),
      });
    if (canManage && onDelete)
      actions.push({
        label: "Delete",
        icon: <Trash2 size={14} />,
        danger: true,
        separated: actions.length > 0,
        onSelect: () => onDelete(asset),
      });
    return actions;
  };
  return (
    <div className={`asset-collection asset-collection--${view}`}>
      {items.map((asset) => {
        // Widget cards already spell their actions out in a footer, so they skip the trigger
        // and keep right-click as the shortcut.
        const showTrigger = !(asset.type === "widget" && canManage);
        return (
          <article
            className={`asset-card${showTrigger ? " asset-card--has-menu" : ""}`}
            key={asset.id}
            onContextMenu={(event) => menu.open(event, asset)}
          >
            {showTrigger && (
              <button
                type="button"
                className="asset-card__menu"
                aria-haspopup="menu"
                aria-expanded={menu.anchor?.target.id === asset.id}
                aria-label={`Actions for ${asset.name}`}
                onClick={(event) => menu.open(event, asset)}
              >
                <EllipsisVertical size={15} aria-hidden="true" />
              </button>
            )}
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
                <AssetPreview asset={asset} />
              </span>
              <span className="asset-card__body">
                <strong>{asset.name}</strong>
                <small>
                  {asset.type === "video" &&
                    formatDuration(asset.durationSeconds)}
                  {asset.type === "widget" &&
                    (asset.widget?.provider === "youtube"
                      ? "YouTube"
                      : asset.widget?.provider
                        ? asset.widget.provider.toUpperCase()
                        : asset.website?.displayUrl)}
                  {asset.width && asset.height
                    ? `${asset.type === "video" ? " · " : ""}${asset.width} × ${asset.height}`
                    : ""}
                </small>
                <small>{formatBytes(asset.originalSize)}</small>
                {(() => {
                  const folderLabel = asset.folderId
                    ? folderNames?.get(asset.folderId)
                    : undefined;
                  if (!folderLabel && !asset.tags?.length) return null;
                  return (
                    <span className="asset-card__organization">
                      {folderLabel && (
                        <span className="organizer-chip organizer-chip--folder">
                          <Folder size={11} aria-hidden />
                          {folderLabel}
                        </span>
                      )}
                      {asset.tags?.map((tag) => (
                        <span key={tag.id} className="organizer-chip">
                          <span
                            className="organizer-chip__dot"
                            style={{ backgroundColor: tag.color }}
                            aria-hidden
                          />
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  );
                })()}
              </span>
              <span
                className={`media-status media-status--${asset.processingStatus}`}
              >
                {statusLabel(asset.processingStatus)}
              </span>
            </button>
            {asset.type === "widget" && (
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
        );
      })}
      {menu.anchor && (
        <ContextMenu
          x={menu.anchor.x}
          y={menu.anchor.y}
          label={`Actions for ${menu.anchor.target.name}`}
          items={actionsFor(menu.anchor.target)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

type OrganizerKind = "folder" | "collection" | "tag";

const organizerCopy: Record<
  OrganizerKind,
  { title: string; label: string; hint: string }
> = {
  folder: {
    title: "Create folder",
    label: "Folder name",
    hint: "Each asset lives in one folder. Use folders for broad areas like buildings or departments.",
  },
  collection: {
    title: "Create collection",
    label: "Collection name",
    hint: "Collections group related assets for reuse. An asset can belong to several collections.",
  },
  tag: {
    title: "Create tag",
    label: "Tag name",
    hint: "Tags are colored labels for quick filtering. An asset can have several tags.",
  },
};

export function CreateOrganizerDialog({
  kind,
  csrf,
  onClose,
  onCreated,
}: {
  kind: OrganizerKind;
  csrf: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#64748b");
  const create = useMutation({
    mutationFn: (): Promise<unknown> =>
      kind === "folder"
        ? api.createContentFolder({ name, description: "" }, csrf)
        : kind === "collection"
          ? api.createContentCollection({ name, description: "" }, csrf)
          : api.createContentTag({ name, color }, csrf),
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });
  const copy = organizerCopy[kind];
  return (
    <Dialog open title={copy.title} onClose={onClose}>
      <form
        className="organizer-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <p className="organizer-dialog__hint">{copy.hint}</p>
        <label className="field">
          <span className="field__label">{copy.label}</span>
          <input
            autoFocus
            required
            value={name}
            maxLength={kind === "tag" ? 60 : 120}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {kind === "tag" && (
          <label className="field organizer-dialog__color">
            <span className="field__label">Color</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
        )}
        {create.isError && (
          <Notice variant="danger">
            {create.error instanceof ApiError
              ? create.error.message
              : `The ${kind} could not be created.`}
          </Notice>
        )}
        <div className="form-actions">
          <Button variant="quiet" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            {copy.title}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ManageOrganizerRow({
  name,
  count,
  onRename,
  onDelete,
}: {
  name: string;
  count: number;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setEditing(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="organizer-manage__row">
      {editing ? (
        <form
          className="organizer-manage__edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void run(() => onRename(value));
          }}
        >
          <input
            autoFocus
            required
            aria-label={`New name for ${name}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="submit"
            className="button button--primary"
            disabled={busy}
          >
            Save
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setEditing(false);
              setValue(name);
              setError("");
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="organizer-manage__name">
            {name} <small>({count})</small>
          </span>
          <span className="organizer-manage__actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} aria-hidden /> Rename
            </button>
            <button
              type="button"
              className="button button--danger-quiet"
              disabled={busy}
              onClick={() => void run(onDelete)}
            >
              <Trash2 size={13} aria-hidden /> Delete
            </button>
          </span>
        </>
      )}
      {error && <span className="field__error">{error}</span>}
    </li>
  );
}

function ManageOrganizationDialog({
  folders,
  collections,
  tags,
  csrf,
  onChanged,
  onClose,
}: {
  folders: ContentFolder[];
  collections: ContentCollection[];
  tags: ContentTag[];
  csrf: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const sections: {
    title: string;
    empty: string;
    rows: {
      id: string;
      name: string;
      count: number;
      rename: (name: string) => Promise<unknown>;
      remove: () => Promise<unknown>;
      confirmText: string;
    }[];
  }[] = [
    {
      title: "Folders",
      empty: "No folders yet.",
      rows: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        count: folder.assetCount,
        rename: (name) =>
          api.updateContentFolder(
            folder.id,
            {
              name,
              description: folder.description,
              parentId: folder.parentId,
            },
            csrf,
          ),
        remove: () => api.deleteContentFolder(folder.id, csrf),
        confirmText: `Delete the folder "${folder.name}"? Its assets stay in the library and become unfiled.`,
      })),
    },
    {
      title: "Collections",
      empty: "No collections yet.",
      rows: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        count: collection.assetCount,
        rename: (name) =>
          api.updateContentCollection(
            collection.id,
            { name, description: collection.description },
            csrf,
          ),
        remove: () => api.deleteContentCollection(collection.id, csrf),
        confirmText: `Delete the collection "${collection.name}"? Its assets stay in the library.`,
      })),
    },
    {
      title: "Tags",
      empty: "No tags yet.",
      rows: tags.map((tag) => ({
        id: tag.id,
        name: tag.name,
        count: tag.assetCount ?? 0,
        rename: (name) =>
          api.updateContentTag(tag.id, { name, color: tag.color }, csrf),
        remove: () => api.deleteContentTag(tag.id, csrf),
        confirmText: `Delete the tag "${tag.name}"? It is removed from all assets.`,
      })),
    },
  ];
  return (
    <Dialog
      open
      title="Manage organization"
      onClose={onClose}
      className="organizer-manage"
    >
      {sections.map((section) => (
        <section key={section.title} className="organizer-manage__section">
          <h3>{section.title}</h3>
          {section.rows.length === 0 ? (
            <p className="organizer-manage__empty">{section.empty}</p>
          ) : (
            <ul>
              {section.rows.map((row) => (
                <ManageOrganizerRow
                  key={row.id}
                  name={row.name}
                  count={row.count}
                  onRename={async (name) => {
                    await row.rename(name);
                    onChanged();
                  }}
                  onDelete={async () => {
                    if (!confirm(row.confirmText)) return;
                    await row.remove();
                    onChanged();
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </Dialog>
  );
}

function ContentOrganizer({
  csrf,
  folders,
  collections,
  tags,
  assetIds,
  onApplied,
  onCatalogChanged,
}: {
  csrf: string;
  folders: ContentFolder[];
  collections: ContentCollection[];
  tags: ContentTag[];
  assetIds: string[];
  onApplied: () => void;
  onCatalogChanged: () => void;
}) {
  const [folderId, setFolderId] = useState("");
  const [tagId, setTagId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<OrganizerKind>();
  const [managing, setManaging] = useState(false);
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
      onApplied();
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
          onClick={() => setCreating("folder")}
        >
          <FolderPlus size={15} /> Create folder
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setCreating("collection")}
        >
          <Library size={15} /> Create collection
        </button>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => setCreating("tag")}
        >
          <Tags size={15} /> Create tag
        </button>
        {(folders.length > 0 || collections.length > 0 || tags.length > 0) && (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setManaging(true)}
          >
            <Pencil size={15} /> Manage
          </button>
        )}
      </div>
      {assetIds.length > 0 && (
        <div className="content-organizer__bulk">
          <strong>{assetIds.length} selected</strong>
          <Select
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
          </Select>
          <Select
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
          </Select>
          <Select
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
          </Select>
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
      {creating && (
        <CreateOrganizerDialog
          kind={creating}
          csrf={csrf}
          onClose={() => setCreating(undefined)}
          onCreated={onCatalogChanged}
        />
      )}
      {managing && (
        <ManageOrganizationDialog
          folders={folders}
          collections={collections}
          tags={tags}
          csrf={csrf}
          onChanged={onCatalogChanged}
          onClose={() => setManaging(false)}
        />
      )}
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
  return props.asset.type === "widget" &&
    props.asset.widget?.provider === "website" ? (
    <WebsiteEditor
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "widget" &&
    props.asset.widget?.provider === "youtube" ? (
    <YouTubeSourceEditor
      asset={props.asset}
      csrf={props.csrf}
      readOnly={!props.canManage}
      onClose={props.onClose}
      onSaved={props.onChanged}
    />
  ) : props.asset.type === "widget" &&
    props.asset.widget &&
    [
      "clock",
      "date",
      "qrcode",
      "ticker",
      "menu",
      "list",
      "table",
      "agenda",
    ].includes(props.asset.widget.provider) ? (
    <NativeAppEditor
      provider={
        props.asset.widget.provider as
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
export function AssetOrganization({
  asset,
  canManage,
  csrf,
  onChanged,
}: {
  asset: Asset;
  canManage: boolean;
  csrf: string;
  onChanged: (asset: Asset) => void;
}) {
  const queryClient = useQueryClient();
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
  const organize = useMutation({
    mutationFn: async (input: Omit<BulkOrganizeInput, "assetIds">) => {
      await api.bulkOrganize({ assetIds: [asset.id], ...input }, csrf);
      return api.asset(asset.id);
    },
    onSuccess: (latest) => {
      onChanged(latest);
      void queryClient.invalidateQueries({ queryKey: ["content-folders"] });
      void queryClient.invalidateQueries({
        queryKey: ["content-collections"],
      });
      void queryClient.invalidateQueries({ queryKey: ["content-tags"] });
    },
  });
  const assetTagIds = new Set((asset.tags ?? []).map((tag) => tag.id));
  const assetCollectionIds = new Set(asset.collectionIds ?? []);
  if (
    !canManage &&
    !asset.folderId &&
    assetTagIds.size === 0 &&
    assetCollectionIds.size === 0
  )
    return null;
  return (
    <section className="asset-organization" aria-label="Organization">
      <h3>Organization</h3>
      <label className="field">
        <span className="field__label">Folder</span>
        <Select
          aria-label="Folder"
          value={asset.folderId ?? ""}
          disabled={!canManage || organize.isPending}
          onChange={(event) =>
            organize.mutate({
              setFolder: true,
              ...(event.target.value ? { folderId: event.target.value } : {}),
            })
          }
        >
          <option value="">Unfiled</option>
          {folders.data?.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="asset-organization__group">
        <span className="field__label">Tags</span>
        {(tags.data?.length ?? 0) === 0 ? (
          <p className="asset-organization__empty">
            No tags yet. Create tags from the media library toolbar.
          </p>
        ) : (
          <div className="asset-organization__chips">
            {tags.data?.map((tag) => {
              const active = assetTagIds.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  className={`organizer-chip${active ? " organizer-chip--active" : ""}`}
                  aria-pressed={active}
                  disabled={!canManage || organize.isPending}
                  onClick={() =>
                    organize.mutate(
                      active
                        ? { removeTagIds: [tag.id] }
                        : { addTagIds: [tag.id] },
                    )
                  }
                >
                  <span
                    className="organizer-chip__dot"
                    style={{ backgroundColor: tag.color }}
                    aria-hidden
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="asset-organization__group">
        <span className="field__label">Collections</span>
        {(collections.data?.length ?? 0) === 0 ? (
          <p className="asset-organization__empty">
            No collections yet. Create collections from the media library
            toolbar.
          </p>
        ) : (
          <div className="asset-organization__chips">
            {collections.data?.map((collection) => {
              const active = assetCollectionIds.has(collection.id);
              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`organizer-chip${active ? " organizer-chip--active" : ""}`}
                  aria-pressed={active}
                  disabled={!canManage || organize.isPending}
                  onClick={() =>
                    organize.mutate(
                      active
                        ? { removeCollectionIds: [collection.id] }
                        : { addCollectionIds: [collection.id] },
                    )
                  }
                >
                  {collection.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {organize.isError && (
        <Notice variant="danger">
          {organize.error instanceof ApiError
            ? organize.error.message
            : "Organization could not be updated."}
        </Notice>
      )}
    </section>
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
  const [availableFrom, setAvailableFrom] = useState(
    dateTimeLocalValue(asset.availableFrom),
  );
  const [expiresAt, setExpiresAt] = useState(
    dateTimeLocalValue(asset.expiresAt),
  );
  const mutation = useMutation({
    mutationFn: () =>
      api.updateAsset(
        asset.id,
        {
          name,
          description,
          availabilitySet: true,
          ...(availableFrom
            ? { availableFrom: new Date(availableFrom).toISOString() }
            : {}),
          ...(expiresAt
            ? { expiresAt: new Date(expiresAt).toISOString() }
            : {}),
        },
        csrf,
      ),
    onSuccess: onChanged,
  });
  return (
    <Drawer
      className="asset-details-drawer"
      eyebrow="Media asset"
      title={asset.name}
      closeLabel="Close asset details"
      onClose={onClose}
      footer={
        canManage ? (
          <>
            <Button
              variant="primary"
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Save changes
            </Button>
            {asset.processingStatus === "failed" && (
              <Button
                variant="quiet"
                onClick={() =>
                  void api.retryAsset(asset.id, csrf).then(onChanged)
                }
              >
                Retry processing
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete ${asset.name}?`))
                  void api.deleteAsset(asset.id, csrf).then(onClose);
              }}
            >
              Delete asset
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="asset-details">
        {asset.thumbnailUrl && (
          <img
            className="details-preview"
            src={asset.thumbnailUrl}
            alt=""
            draggable={false}
          />
        )}
        <label className="field">
          <span className="field__label">Name</span>
          <input
            value={name}
            disabled={!canManage}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="form-grid form-grid--two">
          <label className="field">
            <span className="field__label">Available from</span>
            <input
              type="datetime-local"
              value={availableFrom}
              disabled={!canManage}
              onChange={(event) => setAvailableFrom(event.target.value)}
            />
            <span className="field__hint">
              Leave blank to make this content available immediately.
            </span>
          </label>
          <label className="field">
            <span className="field__label">Expires at</span>
            <input
              type="datetime-local"
              value={expiresAt}
              disabled={!canManage}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <span className="field__hint">
              The Player stops using it at this local date and time, even
              offline.
            </span>
          </label>
        </div>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            value={description}
            disabled={!canManage}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <AssetOrganization
          asset={asset}
          canManage={canManage}
          csrf={csrf}
          onChanged={onChanged}
        />
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
        <UsedByPanel
          emptyMessage="No playlist or Layout uses this media yet."
          groups={[
            {
              label: "Playlists",
              items: asset.playlistsUsing ?? [],
              to: (playlistId) => `/playlists/${playlistId}`,
            },
            {
              label: "Layouts",
              items: (asset.layoutUsage ?? []).map((usage) => ({
                id: usage.id,
                name: usage.name,
                hint: usage.published ? "Published" : "Draft",
              })),
              to: (layoutId) => `/layouts/${layoutId}`,
            },
          ]}
        />
        {asset.errorMessage && (
          <div className="notice notice--error">{asset.errorMessage}</div>
        )}
      </div>
    </Drawer>
  );
}

function dateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
        ? api.updateWidget(asset.id, sourceInput, csrf)
        : api.createWidget(sourceInput, csrf);
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
          <Select
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
          </Select>
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
          <Select
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
          </Select>
        </label>
        <label className="field">
          <span className="field__label">Fallback image</span>
          <Select
            disabled={readOnly}
            value={input.fallbackImageAssetId ?? ""}
            onChange={(e) =>
              set("fallbackImageAssetId", e.target.value || undefined)
            }
          >
            <option value="">None</option>
            {images.data?.items?.map((image) => (
              <option key={image.id} value={image.id}>
                {image.name}
              </option>
            ))}
          </Select>
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
            <Select
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
            </Select>
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
