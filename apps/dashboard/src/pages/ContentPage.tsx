import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileImage,
  FileVideo,
  Grid2X2,
  List,
  Search,
  Upload,
  Globe2,
  Plus,
  Copy,
  Trash2,
  Youtube,
  X,
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
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  SourceProviderGallery,
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
  const [contentFilter, setContentFilter] = useState("all");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("updated");
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
  const [websiteEditor, setWebsiteEditor] = useState(false);
  const [youtubeEditor, setYouTubeEditor] = useState(false);
  const [sourceGallery, setSourceGallery] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const fileInput = useRef<HTMLInputElement>(null);
  const params = new URLSearchParams({ page: "1", pageSize: "48", sort });
  if (search) params.set("search", search);
  if (contentFilter === "media") params.set("type", "media");
  if (["image", "video", "source"].includes(contentFilter))
    params.set("type", contentFilter);
  if (["website", "youtube"].includes(contentFilter)) {
    params.set("type", "source");
    params.set("provider", contentFilter);
  }
  if (status) params.set("status", status);
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
          <h2>Content library</h2>
          <p>Media and reusable Sources available to playlists.</p>
        </div>
        {canManage && (
          <details className="content-add-menu">
            <summary className="button button--primary">
              <Plus size={16} /> Add content
            </summary>
            <div>
              <button type="button" onClick={() => fileInput.current?.click()}>
                <Upload size={16} />
                <span>
                  <strong>Upload media</strong>
                  <small>Add images or videos</small>
                </span>
              </button>
              <button type="button" onClick={() => setSourceGallery(true)}>
                <Globe2 size={16} />
                <span>
                  <strong>Create source</strong>
                  <small>Add dynamic content</small>
                </span>
              </button>
            </div>
          </details>
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
              ["all", "All"],
              ["media", "Media"],
              ["source", "Sources"],
              ["image", "Images"],
              ["video", "Videos"],
              ["website", "Websites"],
              ["youtube", "YouTube"],
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
      {websiteEditor && (
        <WebsiteEditor
          csrf={csrf}
          onClose={() => setWebsiteEditor(false)}
          onSaved={(asset) => {
            setWebsiteEditor(false);
            setSelected(asset);
            void queryClient.invalidateQueries({ queryKey: ["assets"] });
          }}
        />
      )}
      {youtubeEditor && (
        <YouTubeSourceEditor
          csrf={csrf}
          onClose={() => setYouTubeEditor(false)}
          onSaved={(asset) => {
            setYouTubeEditor(false);
            setSelected(asset);
          }}
        />
      )}
      {sourceGallery && (
        <SourceProviderGallery
          onClose={() => setSourceGallery(false)}
          onChoose={(provider) => {
            setSourceGallery(false);
            if (provider === "website") setWebsiteEditor(true);
            else setYouTubeEditor(true);
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
}: {
  items: Asset[];
  view: "grid" | "list";
  onSelect: (asset: Asset) => void;
  canManage?: boolean;
  onDuplicate?: (asset: Asset) => void;
  onDelete?: (asset: Asset) => void;
}) {
  return (
    <div className={`asset-collection asset-collection--${view}`}>
      {items.map((asset) => (
        <article className="asset-card" key={asset.id}>
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
}: {
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
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
      role="presentation"
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
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <h2>{asset ? "Edit Website source" : "Create Website source"}</h2>
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
