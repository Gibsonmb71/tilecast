import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlignCenter,
  AppWindow,
  ArrowDown,
  ArrowUp,
  BoxSelect,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Group,
  History,
  Image as ImageIcon,
  Lock,
  LockOpen,
  ListVideo,
  Minus,
  Redo2,
  RectangleHorizontal,
  Save,
  Scan,
  Type,
  Undo2,
  Ungroup,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type {
  Asset,
  DataSource,
  LayoutDocument,
  LayoutPlacement,
  LayoutPrimitive,
  Playlist,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";

type SaveState = "saved" | "unsaved" | "saving" | "conflict" | "error";
const clone = <T,>(value: T): T => structuredClone(value);
const selectedPlacements = (document: LayoutDocument, selection: Set<string>) =>
  document.placements.filter((item) => selection.has(item.id));

export function createPrimitivePlacement(
  kind: LayoutPrimitive["kind"],
  canvas: LayoutDocument["canvas"],
): LayoutPlacement {
  const isLine = kind === "line";
  const isGroup = kind === "group";
  return {
    id: crypto.randomUUID(),
    type: "primitive",
    name: kind === "text" ? "Text" : kind[0]!.toUpperCase() + kind.slice(1),
    x: canvas.width * 0.25,
    y: canvas.height * 0.25,
    width: isLine
      ? canvas.width * 0.3
      : isGroup
        ? canvas.width * 0.4
        : canvas.width * 0.25,
    height: isLine ? 8 : isGroup ? canvas.height * 0.3 : canvas.height * 0.16,
    layer: 1,
    opacity: 1,
    visible: true,
    locked: false,
    primitive: {
      kind,
      text: kind === "text" ? "New text" : undefined,
      fontFamily: "Inter",
      fontSize: 64,
      fontWeight: 600,
      textAlign: "left",
      verticalAlign: "center",
      color: "#FFFFFF",
      backgroundColor: "#00000000",
      lineHeight: 1.2,
      letterSpacing: 0,
      padding: 12,
      borderWidth: 0,
      borderColor: "#FFFFFF",
      cornerRadius: 0,
      maximumLines: 4,
      overflow: "ellipsis",
      autoFit: false,
      minimumFontSize: 18,
      fillColor:
        kind === "circle" || kind === "rectangle" ? "#2D7FF9" : "#00000000",
      strokeColor: "#FFFFFF",
      strokeWidth: kind === "line" ? 6 : 0,
    },
  };
}

export function LayoutEditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const queryClient = useQueryClient();
  const layoutQuery = useQuery({
    queryKey: ["layout", id],
    queryFn: () => api.layout(id),
    enabled: Boolean(id),
  });
  const contentQuery = useQuery({
    queryKey: ["layout-content-library"],
    queryFn: () =>
      api.assets(
        new URLSearchParams({
          status: "ready",
          page: "1",
          pageSize: "100",
          sort: "name",
        }),
      ),
  });
  const playlistsQuery = useQuery({
    queryKey: ["layout-playlists"],
    queryFn: () => api.playlists(""),
  });
  const dataSourcesQuery = useQuery({
    queryKey: ["layout-data-sources"],
    queryFn: () =>
      api.listDataSources(
        new URLSearchParams({ page: "1", pageSize: "100", sort: "name" }),
      ),
  });
  const revisions = useQuery({
    queryKey: ["layout-revisions", id],
    queryFn: () => api.layoutRevisions(id),
    enabled: false,
  });
  const [document, setDocument] = useState<LayoutDocument>();
  const [selection, setSelection] = useState(new Set<string>());
  const [past, setPast] = useState<LayoutDocument[]>([]);
  const [future, setFuture] = useState<LayoutDocument[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [serverRevision, setServerRevision] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [safeArea, setSafeArea] = useState(true);
  const [preview, setPreview] = useState(false);
  const [previewDate, setPreviewDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [previewValues, setPreviewValues] = useState<
    Record<string, Record<string, string>>
  >({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const clipboard = useRef<LayoutPlacement[]>([]);
  const initialized = useRef(false);
  const documentRef = useRef<LayoutDocument | undefined>(undefined);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  useEffect(() => {
    if (!layoutQuery.data || initialized.current) return;
    initialized.current = true;
    const next = clone(layoutQuery.data.draft);
    setDocument(next);
    documentRef.current = next;
    setServerRevision(layoutQuery.data.draftRevision);
    revisionRef.current = layoutQuery.data.draftRevision;
  }, [layoutQuery.data]);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);
  useEffect(() => {
    revisionRef.current = serverRevision;
  }, [serverRevision]);
  const commit = useCallback((next: LayoutDocument) => {
    setDocument((current) => {
      if (current) setPast((items) => [...items.slice(-79), clone(current)]);
      return next;
    });
    setFuture([]);
    setSaveState("unsaved");
  }, []);
  const update = useCallback(
    (change: (draft: LayoutDocument) => void) => {
      if (!documentRef.current) return;
      const next = clone(documentRef.current);
      change(next);
      commit(next);
    },
    [commit],
  );
  const undo = useCallback(() => {
    setPast((items) => {
      const prior = items.at(-1);
      if (!prior) return items;
      setDocument((current) => {
        if (current) setFuture((next) => [clone(current), ...next]);
        return clone(prior);
      });
      setSaveState("unsaved");
      return items.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setDocument((current) => {
        if (current) setPast((previous) => [...previous, clone(current)]);
        return clone(next);
      });
      setSaveState("unsaved");
      return items.slice(1);
    });
  }, []);
  const save = useCallback(async () => {
    const current = documentRef.current;
    if (!current || savingRef.current || saveState === "saved") return;
    savingRef.current = true;
    setSaveState("saving");
    try {
      const saved = await api.saveLayoutDraft(
        id,
        revisionRef.current,
        current,
        csrf,
      );
      setServerRevision(saved.draftRevision);
      setSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
    } catch (error) {
      setSaveState(
        error instanceof ApiError && error.code === "layout_revision_conflict"
          ? "conflict"
          : "error",
      );
    } finally {
      savingRef.current = false;
    }
  }, [csrf, id, queryClient, saveState]);
  useEffect(() => {
    if (saveState !== "unsaved") return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [document, save, saveState]);
  const publish = useMutation({
    mutationFn: () => api.publishLayout(id, serverRevision, csrf),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["layout", id] });
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
    },
  });
  const restore = useMutation({
    mutationFn: (revisionId: string) =>
      api.restoreLayoutRevision(id, revisionId, serverRevision, csrf),
    onSuccess: (saved) => {
      const next = clone(saved.draft);
      setDocument(next);
      documentRef.current = next;
      setServerRevision(saved.draftRevision);
      setPast([]);
      setFuture([]);
      setSaveState("saved");
      setHistoryOpen(false);
    },
  });
  const selected = useMemo(
    () => (document ? selectedPlacements(document, selection) : []),
    [document, selection],
  );
  const primary = selected.at(-1);
  const mutateSelected = useCallback(
    (change: (item: LayoutPlacement) => void) =>
      update((draft) =>
        draft.placements.forEach((item) => {
          if (selection.has(item.id)) change(item);
        }),
      ),
    [selection, update],
  );
  const addPrimitive = (kind: LayoutPrimitive["kind"]) => {
    if (!document) return;
    const item = createPrimitivePlacement(kind, document.canvas);
    update((draft) => {
      item.layer = Math.max(0, ...draft.placements.map((x) => x.layer)) + 1;
      draft.placements.push(item);
    });
    setSelection(new Set([item.id]));
  };
  const addContent = (asset: Asset) => {
    if (!document) return;
    const isApp = asset.type === "widget";
    const item: LayoutPlacement = {
      id: crypto.randomUUID(),
      type: isApp ? "widget" : "asset",
      name: asset.name,
      x: document.canvas.width * 0.2,
      y: document.canvas.height * 0.2,
      width: document.canvas.width * 0.4,
      height: document.canvas.height * 0.4,
      layer:
        Math.max(
          0,
          ...document.placements.map((placement) => placement.layer),
        ) + 1,
      opacity: 1,
      visible: true,
      locked: false,
      widgetId: isApp ? asset.id : undefined,
      assetId: isApp ? undefined : asset.id,
      overrides: isApp
        ? {
            fit: "contain",
            alignment: "center",
            fallbackVisibility: "show",
            muted: true,
          }
        : undefined,
      playback: !isApp
        ? {
            fit: "contain",
            muted: true,
            loop: true,
            fallback: "hide",
            cornerRadius: 0,
          }
        : undefined,
    };
    update((draft) => draft.placements.push(item));
    setSelection(new Set([item.id]));
  };
  const addPlaylistZone = (playlist: Playlist) => {
    if (!document) return;
    const item: LayoutPlacement = {
      id: crypto.randomUUID(),
      type: "playlistZone",
      name: playlist.name,
      x: document.canvas.width * 0.2,
      y: document.canvas.height * 0.2,
      width: document.canvas.width * 0.4,
      height: document.canvas.height * 0.4,
      layer: Math.max(0, ...document.placements.map((p) => p.layer)) + 1,
      opacity: 1,
      visible: true,
      locked: false,
      playlistId: playlist.id,
      playback: {
        fit: "contain",
        muted: true,
        loop: true,
        fallback: "background",
        cornerRadius: 0,
      },
    };
    update((draft) => draft.placements.push(item));
    setSelection(new Set([item.id]));
  };
  // Text-binding preview values are keyed by Data Source id. Field values come from
  // each Data Source's own cached, date-selected records (owned by the Data Source,
  // not duplicated into the Layout), so previewing here just re-reads current caches.
  const loadStructuredPreview = () => {
    setPreviewValues({});
  };
  const duplicateSelection = useCallback(() => {
    const current = documentRef.current;
    if (!current) return;
    const source = selectedPlacements(current, selection);
    if (!source.length) return;
    const mapping = new Map(
      source.map((item) => [item.id, crypto.randomUUID()]),
    );
    const copies = source.map((item) => ({
      ...clone(item),
      id: mapping.get(item.id)!,
      name: `${item.name} copy`,
      x: Math.min(item.x + 20, current.canvas.width - item.width),
      y: Math.min(item.y + 20, current.canvas.height - item.height),
      groupId: item.groupId && mapping.get(item.groupId),
    }));
    update((draft) => draft.placements.push(...copies));
    setSelection(new Set(copies.map((item) => item.id)));
  }, [selection, update]);
  const groupSelection = useCallback(() => {
    if (!documentRef.current || selection.size < 2) return;
    const items = selectedPlacements(documentRef.current, selection);
    const x = Math.min(...items.map((i) => i.x)),
      y = Math.min(...items.map((i) => i.y)),
      right = Math.max(...items.map((i) => i.x + i.width)),
      bottom = Math.max(...items.map((i) => i.y + i.height));
    const group = createPrimitivePlacement("group", documentRef.current.canvas);
    group.x = x;
    group.y = y;
    group.width = right - x;
    group.height = bottom - y;
    group.name = "Group";
    group.layer = Math.max(...items.map((i) => i.layer));
    update((draft) => {
      draft.placements.push(group);
      draft.placements.forEach((item) => {
        if (selection.has(item.id)) item.groupId = group.id;
      });
    });
    setSelection(new Set([group.id]));
  }, [selection, update]);
  const ungroupSelection = useCallback(() => {
    const groups = new Set(
      selected.filter((i) => i.primitive?.kind === "group").map((i) => i.id),
    );
    if (!groups.size) return;
    update((draft) => {
      draft.placements = draft.placements.filter(
        (item) => !groups.has(item.id),
      );
      draft.placements.forEach((item) => {
        if (item.groupId && groups.has(item.groupId)) delete item.groupId;
      });
    });
    setSelection(new Set());
  }, [selected, update]);
  const beginMove = (
    event: ReactPointerEvent,
    item: LayoutPlacement,
    resize = false,
  ) => {
    event.stopPropagation();
    if (item.locked) return;
    const sourceDocument = documentRef.current;
    if (!sourceDocument || !canvasRef.current) return;
    if (!selection.has(item.id))
      setSelection(
        new Set(event.shiftKey ? [...selection, item.id] : [item.id]),
      );
    const active = selection.has(item.id)
      ? new Set(selection)
      : new Set([item.id]);
    const start = { x: event.clientX, y: event.clientY };
    const initial = new Map(
      sourceDocument.placements
        .filter((p) => active.has(p.id) || p.groupId === item.id)
        .map((p) => [p.id, clone(p)]),
    );
    const beforeDocument = clone(sourceDocument);
    const bounds = canvasRef.current.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const current = documentRef.current;
      if (!current) return;
      const dx =
          ((pointer.clientX - start.x) * current.canvas.width) / bounds.width,
        dy =
          ((pointer.clientY - start.y) * current.canvas.height) / bounds.height;
      const next = clone(current);
      const groupWidth = Math.max(
        20,
        Math.min(next.canvas.width - item.x, item.width + dx),
      );
      const groupHeight = Math.max(
        20,
        Math.min(next.canvas.height - item.y, item.height + dy),
      );
      next.placements.forEach((p) => {
        const before = initial.get(p.id);
        if (!before) return;
        if (resize && p.id === item.id) {
          p.width = groupWidth;
          p.height = groupHeight;
        } else if (resize && before.groupId === item.id) {
          const scaleX = groupWidth / item.width;
          const scaleY = groupHeight / item.height;
          p.x = item.x + (before.x - item.x) * scaleX;
          p.y = item.y + (before.y - item.y) * scaleY;
          p.width = before.width * scaleX;
          p.height = before.height * scaleY;
        } else {
          p.x = Math.max(
            0,
            Math.min(next.canvas.width - p.width, before.x + dx),
          );
          p.y = Math.max(
            0,
            Math.min(next.canvas.height - p.height, before.y + dy),
          );
          if (snap) {
            p.x = Math.round(p.x / 10) * 10;
            p.y = Math.round(p.y / 10) * 10;
          }
        }
      });
      const main = next.placements.find((p) => p.id === item.id);
      setGuides(
        main
          ? {
              x:
                Math.abs(main.x + main.width / 2 - next.canvas.width / 2) < 8
                  ? next.canvas.width / 2
                  : undefined,
              y:
                Math.abs(main.y + main.height / 2 - next.canvas.height / 2) < 8
                  ? next.canvas.height / 2
                  : undefined,
            }
          : {},
      );
      documentRef.current = next;
      setDocument(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({});
      setPast((items) => [...items.slice(-79), beforeDocument]);
      setFuture([]);
      setSaveState("unsaved");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches("input,textarea,select"))
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
        clipboard.current = clone(selected);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        const pasted = clipboard.current.map((item) => ({
          ...clone(item),
          id: crypto.randomUUID(),
          x: item.x + 20,
          y: item.y + 20,
          groupId: undefined,
        }));
        if (pasted.length) {
          update((d) => d.placements.push(...pasted));
          setSelection(new Set(pasted.map((i) => i.id)));
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        update((d) => {
          d.placements = d.placements.filter((i) => !selection.has(i.id));
          d.placements.forEach((i) => {
            if (i.groupId && selection.has(i.groupId)) delete i.groupId;
          });
        });
        setSelection(new Set());
        return;
      }
      const delta = event.shiftKey ? 10 : 1;
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        mutateSelected((item) => {
          const current = documentRef.current;
          if (!current) return;
          if (item.locked) return;
          if (event.key === "ArrowLeft") item.x = Math.max(0, item.x - delta);
          if (event.key === "ArrowRight")
            item.x = Math.min(
              current.canvas.width - item.width,
              item.x + delta,
            );
          if (event.key === "ArrowUp") item.y = Math.max(0, item.y - delta);
          if (event.key === "ArrowDown")
            item.y = Math.min(
              current.canvas.height - item.height,
              item.y + delta,
            );
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    duplicateSelection,
    groupSelection,
    mutateSelected,
    redo,
    selected,
    selection,
    undo,
    ungroupSelection,
    update,
  ]);
  if (layoutQuery.isLoading || !document)
    return <p className="status-copy">Loading Layout editor…</p>;
  if (layoutQuery.isError)
    return (
      <div className="empty-state">
        <h2>Layout unavailable</h2>
        <button className="button" onClick={() => void navigate("/layouts")}>
          Back to Layouts
        </button>
      </div>
    );
  const contentByID = new Map(
    contentQuery.data?.items.map((asset) => [asset.id, asset]),
  );
  const playlistByID = new Map(
    playlistsQuery.data?.items.map((playlist) => [playlist.id, playlist]),
  );
  const dataSources = dataSourcesQuery.data?.items ?? [];
  return (
    <div className="layout-editor">
      <div className="layout-editor-toolbar">
        <button
          className="icon-button"
          title="Undo"
          onClick={undo}
          disabled={!past.length}
        >
          <Undo2 size={17} />
        </button>
        <button
          className="icon-button"
          title="Redo"
          onClick={redo}
          disabled={!future.length}
        >
          <Redo2 size={17} />
        </button>
        <span className="toolbar-divider" />
        <button
          className="button button--compact button--secondary"
          onClick={() => {
            setPreview(true);
            void loadStructuredPreview();
          }}
        >
          <Scan size={16} />
          Preview
        </button>
        <button
          className="button button--compact button--secondary"
          onClick={() => {
            setHistoryOpen(true);
            void revisions.refetch();
          }}
        >
          <History size={16} />
          History
        </button>
        <span className={`layout-save-state layout-save-state--${saveState}`}>
          <Save size={14} />
          {saveState === "saved"
            ? "Saved"
            : saveState === "saving"
              ? "Saving…"
              : saveState === "conflict"
                ? "Reload required"
                : saveState === "error"
                  ? "Save failed"
                  : "Unsaved"}
        </span>
        <button
          className="button button--compact button--primary"
          disabled={saveState !== "saved" || publish.isPending}
          onClick={() => publish.mutate()}
        >
          {publish.isPending ? "Publishing…" : "Publish"}
        </button>
      </div>
      <aside className="layout-editor-left">
        <div className="layout-panel-heading">
          <strong>Add</strong>
          <span>Primitives</span>
        </div>
        <div className="layout-add-grid">
          <button onClick={() => addPrimitive("text")}>
            <Type size={20} />
            Text
          </button>
          <button onClick={() => addPrimitive("rectangle")}>
            <RectangleHorizontal size={20} />
            Rectangle
          </button>
          <button onClick={() => addPrimitive("circle")}>
            <Circle size={20} />
            Circle
          </button>
          <button onClick={() => addPrimitive("line")}>
            <Minus size={20} />
            Line
          </button>
        </div>
        <div className="layout-panel-heading">
          <strong>Content</strong>
          <span>{contentQuery.data?.items.length ?? 0}</span>
        </div>
        <div className="layout-content-shelf">
          {contentQuery.data?.items.map((asset) => (
            <button
              key={asset.id}
              onClick={() => addContent(asset)}
              title={`Add ${asset.name}`}
            >
              <span className="layout-content-shelf__preview">
                {asset.thumbnailUrl ? (
                  <img src={asset.thumbnailUrl} alt="" />
                ) : asset.type === "widget" ? (
                  <AppWindow size={18} />
                ) : (
                  <ImageIcon size={18} />
                )}
              </span>
              <span>
                <strong>{asset.name}</strong>
                <small>{asset.widget?.provider ?? asset.type}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="layout-panel-heading">
          <strong>Playlist zones</strong>
          <span>{playlistsQuery.data?.items.length ?? 0}</span>
        </div>
        <div className="layout-content-shelf">
          {playlistsQuery.data?.items.map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => addPlaylistZone(playlist)}
              title={`Add ${playlist.name} zone`}
            >
              <span className="layout-content-shelf__preview">
                <ListVideo size={18} />
              </span>
              <span>
                <strong>{playlist.name}</strong>
                <small>{playlist.itemCount} items</small>
              </span>
            </button>
          ))}
        </div>
        <div className="layout-panel-heading">
          <strong>Layers</strong>
          <span>{document.placements.length}</span>
        </div>
        <div className="layout-layers">
          {[...document.placements]
            .sort((a, b) => b.layer - a.layer)
            .map((item) => (
              <button
                key={item.id}
                className={selection.has(item.id) ? "is-selected" : ""}
                onClick={(event) =>
                  setSelection(
                    new Set(
                      event.shiftKey ? [...selection, item.id] : [item.id],
                    ),
                  )
                }
              >
                <span className="layout-layer-icon">
                  {item.primitive?.kind === "text" ? (
                    <Type size={14} />
                  ) : item.primitive?.kind === "group" ? (
                    <Group size={14} />
                  ) : (
                    <BoxSelect size={14} />
                  )}
                </span>
                <span>{item.name}</span>
                <span className="layout-layer-actions">
                  <span
                    role="button"
                    tabIndex={0}
                    title={item.visible ? "Hide" : "Show"}
                    onClick={(event) => {
                      event.stopPropagation();
                      update((d) => {
                        const target = d.placements.find(
                          (x) => x.id === item.id,
                        );
                        if (target) target.visible = !target.visible;
                      });
                    }}
                  >
                    {item.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    title={item.locked ? "Unlock" : "Lock"}
                    onClick={(event) => {
                      event.stopPropagation();
                      update((d) => {
                        const target = d.placements.find(
                          (x) => x.id === item.id,
                        );
                        if (target) target.locked = !target.locked;
                      });
                    }}
                  >
                    {item.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </aside>
      <main className="layout-stage">
        <div className="layout-stage-controls">
          <button
            className="icon-button"
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            className="icon-button"
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(event) => setSnap(event.target.checked)}
            />
            Snap
          </label>
          <label>
            <input
              type="checkbox"
              checked={safeArea}
              onChange={(event) => setSafeArea(event.target.checked)}
            />
            Safe area
          </label>
        </div>
        <div
          className="layout-stage-scroll"
          onPointerDown={() => setSelection(new Set())}
        >
          <div
            ref={canvasRef}
            className="layout-canvas"
            style={{
              aspectRatio: `${document.canvas.width}/${document.canvas.height}`,
              width: `${zoom * 100}%`,
              backgroundColor: document.canvas.backgroundColor,
            }}
          >
            {safeArea && (
              <div
                className="layout-safe-area"
                style={{ inset: `${document.canvas.safeAreaPercent}%` }}
              />
            )}
            {guides.x !== undefined && (
              <span
                className="layout-guide layout-guide--vertical"
                style={{ left: `${(guides.x / document.canvas.width) * 100}%` }}
              />
            )}
            {guides.y !== undefined && (
              <span
                className="layout-guide layout-guide--horizontal"
                style={{ top: `${(guides.y / document.canvas.height) * 100}%` }}
              />
            )}
            {[...document.placements]
              .sort((a, b) => a.layer - b.layer)
              .map((item) => (
                <PlacementView
                  key={item.id}
                  item={item}
                  content={
                    item.widgetId
                      ? contentByID.get(item.widgetId)
                      : item.assetId
                        ? contentByID.get(item.assetId)
                        : undefined
                  }
                  playlist={
                    item.playlistId
                      ? playlistByID.get(item.playlistId)
                      : undefined
                  }
                  canvas={document.canvas}
                  selected={selection.has(item.id)}
                  onPointerDown={(event) => beginMove(event, item)}
                  onResize={(event) => beginMove(event, item, true)}
                />
              ))}
          </div>
        </div>
      </main>
      <aside className="layout-editor-right">
        <div className="layout-panel-heading">
          <strong>Inspector</strong>
          <span>
            {selected.length ? `${selected.length} selected` : "Canvas"}
          </span>
        </div>
        {primary ? (
          <PlacementInspector
            item={primary}
            content={
              primary.widgetId
                ? contentByID.get(primary.widgetId)
                : primary.assetId
                  ? contentByID.get(primary.assetId)
                  : undefined
            }
            playlist={
              primary.playlistId
                ? playlistByID.get(primary.playlistId)
                : undefined
            }
            dataSources={dataSources}
            update={(change) => mutateSelected(change)}
            duplicate={duplicateSelection}
            group={groupSelection}
            ungroup={ungroupSelection}
            canGroup={selection.size > 1}
          />
        ) : (
          <CanvasInspector document={document} update={update} />
        )}
        {(layoutQuery.data?.usage.screens.length ||
          layoutQuery.data?.usage.schedules.length) && (
          <div className="content-usage-list">
            <h3>Used in</h3>
            {layoutQuery.data.usage.screens.map((screen) => (
              <a key={screen.id} href={`/screens/${screen.id}`}>
                <span>{screen.name}</span>
                <small>Screen</small>
              </a>
            ))}
            {layoutQuery.data.usage.schedules.map((schedule) => (
              <a key={schedule.id} href={`/schedules/${schedule.id}`}>
                <span>{schedule.name}</span>
                <small>Schedule</small>
              </a>
            ))}
          </div>
        )}
      </aside>
      {preview && (
        <div className="layout-preview-overlay" role="dialog" aria-modal="true">
          <div className="layout-preview-toolbar">
            <strong>{layoutQuery.data?.name}</strong>
            <span>
              {document.canvas.width} × {document.canvas.height}
            </span>
            <input
              type="date"
              aria-label="Preview date"
              value={previewDate}
              onChange={(event) => {
                setPreviewDate(event.target.value);
                void loadStructuredPreview();
              }}
            />
            <button
              className="button button--secondary"
              onClick={() => setPreview(false)}
            >
              Close preview
            </button>
          </div>
          <div
            className="layout-preview-frame"
            style={{
              aspectRatio: `${document.canvas.width}/${document.canvas.height}`,
              backgroundColor: document.canvas.backgroundColor,
            }}
          >
            {[...document.placements]
              .sort((a, b) => a.layer - b.layer)
              .map((item) => (
                <PlacementView
                  key={item.id}
                  item={item}
                  canvas={document.canvas}
                  content={
                    item.widgetId
                      ? contentByID.get(item.widgetId)
                      : item.assetId
                        ? contentByID.get(item.assetId)
                        : undefined
                  }
                  playlist={
                    item.playlistId
                      ? playlistByID.get(item.playlistId)
                      : undefined
                  }
                  previewValues={previewValues}
                />
              ))}
          </div>
        </div>
      )}
      {historyOpen && (
        <div className="details-backdrop">
          <section
            className="asset-details layout-history"
            role="dialog"
            aria-modal="true"
          >
            <header>
              <div>
                <h2>Published revisions</h2>
                <p>Restoring creates a new editable draft.</p>
              </div>
            </header>
            <div className="source-editor__body">
              {revisions.isLoading ? (
                <p>Loading history…</p>
              ) : revisions.data?.items.length ? (
                revisions.data.items.map((revision) => (
                  <div className="layout-history-row" key={revision.id}>
                    <div>
                      <strong>Revision {revision.revision}</strong>
                      <span>
                        {new Date(revision.publishedAt).toLocaleString()}
                      </span>
                      <code>{revision.documentSha256.slice(0, 12)}</code>
                    </div>
                    <button
                      className="button button--secondary"
                      onClick={() => restore.mutate(revision.id)}
                    >
                      Restore as draft
                    </button>
                  </div>
                ))
              ) : (
                <p>No published revisions yet.</p>
              )}
            </div>
            <footer>
              <button
                className="button button--secondary"
                onClick={() => setHistoryOpen(false)}
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function PlacementView({
  item,
  canvas,
  content,
  playlist,
  previewValues,
  selected = false,
  onPointerDown,
  onResize,
}: {
  item: LayoutPlacement;
  canvas: LayoutDocument["canvas"];
  content?: Asset;
  playlist?: Playlist;
  previewValues?: Record<string, Record<string, string>>;
  selected?: boolean;
  onPointerDown?: (event: ReactPointerEvent) => void;
  onResize?: (event: ReactPointerEvent) => void;
}) {
  if (!item.visible) return null;
  const primitive = item.primitive;
  const style: React.CSSProperties = {
    left: `${(item.x / canvas.width) * 100}%`,
    top: `${(item.y / canvas.height) * 100}%`,
    width: `${(item.width / canvas.width) * 100}%`,
    height: `${(item.height / canvas.height) * 100}%`,
    zIndex: item.layer,
    opacity: item.opacity,
  };
  return (
    <div
      className={`layout-placement ${selected ? "is-selected" : ""} ${item.locked ? "is-locked" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
    >
      {item.type === "playlistZone" ? (
        <div className="layout-playlist-zone">
          <ListVideo size={22} />
          <strong>{playlist?.name ?? item.name}</strong>
          <span>{playlist?.itemCount ?? 0} items · independent loop</span>
        </div>
      ) : item.type === "asset" ? (
        content?.thumbnailUrl ? (
          <img
            className="layout-asset-placement"
            src={content.thumbnailUrl}
            alt=""
            style={{
              objectFit:
                item.playback?.fit === "cover"
                  ? "cover"
                  : item.playback?.fit === "stretch"
                    ? "fill"
                    : "contain",
              borderRadius: item.playback?.cornerRadius,
            }}
          />
        ) : (
          <div className="layout-placement-placeholder">
            <ImageIcon size={22} />
            <span>{content?.name ?? item.name}</span>
          </div>
        )
      ) : item.type === "widget" ? (
        <AppPlacementPreview asset={content} item={item} />
      ) : primitive?.kind === "text" ? (
        <div
          className="layout-text-primitive"
          style={{
            fontFamily: primitive.fontFamily,
            fontSize: `${((primitive.fontSize ?? 48) / canvas.width) * 100}cqw`,
            fontWeight: primitive.fontWeight,
            textAlign: primitive.textAlign,
            color: primitive.color,
            backgroundColor: primitive.backgroundColor,
            lineHeight: primitive.lineHeight,
            letterSpacing: primitive.letterSpacing,
            padding: `${((primitive.padding ?? 0) / canvas.width) * 100}cqw`,
            border: `${primitive.borderWidth ?? 0}px solid ${primitive.borderColor ?? "transparent"}`,
            borderRadius: `${primitive.cornerRadius ?? 0}px`,
            justifyContent:
              primitive.verticalAlign === "top"
                ? "flex-start"
                : primitive.verticalAlign === "bottom"
                  ? "flex-end"
                  : "center",
            WebkitLineClamp: primitive.maximumLines,
            overflow: primitive.overflow === "clip" ? "hidden" : "hidden",
          }}
        >
          {primitive.binding
            ? (() => {
                const binding = primitive.binding;
                const value =
                  previewValues?.[binding.dataSourceId]?.[binding.field];
                return value
                  ? `${binding.prefix ?? ""}${value}${binding.suffix ?? ""}`
                  : binding.fallbackText ||
                      `${binding.prefix ?? ""}{{${binding.field}}}${binding.suffix ?? ""}`;
              })()
            : primitive.text}
        </div>
      ) : primitive?.kind === "circle" ? (
        <div
          className="layout-shape layout-shape--circle"
          style={{
            background: primitive.fillColor,
            border: `${primitive.strokeWidth ?? 0}px solid ${primitive.strokeColor ?? "transparent"}`,
          }}
        />
      ) : primitive?.kind === "line" ? (
        <div
          className="layout-line"
          style={{
            height: `${Math.max(1, primitive.strokeWidth ?? 4)}px`,
            background: primitive.strokeColor,
          }}
        />
      ) : primitive?.kind === "group" ? (
        <div className="layout-group-outline">
          <Group size={18} />
          <span>{item.name}</span>
        </div>
      ) : (
        <div
          className="layout-shape"
          style={{
            background: primitive?.fillColor,
            border: `${primitive?.strokeWidth ?? 0}px solid ${primitive?.strokeColor ?? "transparent"}`,
            borderRadius: `${primitive?.cornerRadius ?? 0}px`,
          }}
        />
      )}
      {selected && !item.locked && onResize && (
        <button
          className="layout-resize-handle"
          aria-label="Resize"
          onPointerDown={onResize}
        />
      )}
    </div>
  );
}

function AppPlacementPreview({
  asset,
  item,
}: {
  asset?: Asset;
  item: LayoutPlacement;
}) {
  const provider = asset?.widget?.provider;
  const config = (asset?.widget?.configuration ?? {}) as Record<
    string,
    unknown
  >;
  const background =
    (item.overrides?.backgroundColor as string | undefined) ??
    (config.backgroundColor as string | undefined) ??
    "#18232D";
  const foreground =
    (item.overrides?.foregroundColor as string | undefined) ??
    (config.foregroundColor as string | undefined) ??
    "#F5F7FA";
  let value = asset?.name ?? item.name;
  if (provider === "clock") {
    const timezone =
      typeof config.timezone === "string" ? config.timezone : "UTC";
    value = new Intl.DateTimeFormat(undefined, {
      timeStyle: config.showSeconds ? "medium" : "short",
      timeZone: timezone,
    }).format(new Date());
  } else if (provider === "date") {
    const timezone =
      typeof config.timezone === "string" ? config.timezone : "UTC";
    value = new Intl.DateTimeFormat(undefined, {
      dateStyle:
        (config.format as "full" | "long" | "medium" | "short") ?? "full",
      timeZone: timezone,
    }).format(new Date());
  } else if (provider === "qrcode")
    value =
      typeof config.label === "string" && config.label
        ? config.label
        : "QR Code";
  else if (provider === "ticker")
    value = `${asset?.name ?? "Ticker"} · live data`;
  return (
    <div
      className={`layout-app-placement layout-app-placement--${provider ?? "unknown"}`}
      style={{
        background,
        color: foreground,
        alignItems:
          item.overrides?.alignment === "left"
            ? "flex-start"
            : item.overrides?.alignment === "right"
              ? "flex-end"
              : "center",
      }}
    >
      <span className="layout-app-placement__provider">
        {provider ?? "App"}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 7680,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field field--compact">
      <span className="field__label">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
function PlacementInspector({
  item,
  content,
  playlist,
  dataSources,
  update,
  duplicate,
  group,
  ungroup,
  canGroup,
}: {
  item: LayoutPlacement;
  content?: Asset;
  playlist?: Playlist;
  dataSources: DataSource[];
  update: (change: (item: LayoutPlacement) => void) => void;
  duplicate: () => void;
  group: () => void;
  ungroup: () => void;
  canGroup: boolean;
}) {
  const navigate = useNavigate();
  const primitive = item.primitive;
  return (
    <div className="layout-inspector">
      <label className="field">
        <span className="field__label">Layer name</span>
        <input
          value={item.name}
          onChange={(event) =>
            update((target) => (target.name = event.target.value))
          }
        />
      </label>
      <div className="form-grid form-grid--2">
        <NumberField
          label="X"
          value={item.x}
          onChange={(value) => update((target) => (target.x = value))}
        />
        <NumberField
          label="Y"
          value={item.y}
          onChange={(value) => update((target) => (target.y = value))}
        />
        <NumberField
          label="Width"
          value={item.width}
          min={1}
          onChange={(value) => update((target) => (target.width = value))}
        />
        <NumberField
          label="Height"
          value={item.height}
          min={1}
          onChange={(value) => update((target) => (target.height = value))}
        />
      </div>
      <NumberField
        label="Opacity"
        value={item.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(value) => update((target) => (target.opacity = value))}
      />
      <div className="layout-inspector-actions">
        <button
          className="icon-button"
          title="Move forward"
          onClick={() =>
            update((target) => (target.layer = Math.min(999, target.layer + 1)))
          }
        >
          <ArrowUp size={16} />
        </button>
        <button
          className="icon-button"
          title="Move backward"
          onClick={() =>
            update((target) => (target.layer = Math.max(0, target.layer - 1)))
          }
        >
          <ArrowDown size={16} />
        </button>
        <button className="icon-button" title="Duplicate" onClick={duplicate}>
          <Copy size={16} />
        </button>
        <button
          className="icon-button"
          title="Lock"
          onClick={() => update((target) => (target.locked = !target.locked))}
        >
          {item.locked ? <Lock size={16} /> : <LockOpen size={16} />}
        </button>
        <button
          className="icon-button"
          title="Hide"
          onClick={() => update((target) => (target.visible = !target.visible))}
        >
          {item.visible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>
      {item.type === "widget" && (
        <div className="layout-placement-settings">
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Fit</span>
              <select
                value={(item.overrides?.fit as string | undefined) ?? "contain"}
                onChange={(event) =>
                  update((target) => {
                    target.overrides = {
                      ...target.overrides,
                      fit: event.target.value,
                    };
                  })
                }
              >
                <option value="contain">Fit</option>
                <option value="cover">Fill</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Alignment</span>
              <select
                value={
                  (item.overrides?.alignment as string | undefined) ?? "center"
                }
                onChange={(event) =>
                  update((target) => {
                    target.overrides = {
                      ...target.overrides,
                      alignment: event.target.value,
                    };
                  })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Foreground</span>
              <input
                type="color"
                value={(
                  (item.overrides?.foregroundColor as string | undefined) ??
                  "#F5F7FA"
                ).slice(0, 7)}
                onChange={(event) =>
                  update((target) => {
                    target.overrides = {
                      ...target.overrides,
                      foregroundColor: event.target.value,
                    };
                  })
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Background</span>
              <input
                type="color"
                value={(
                  (item.overrides?.backgroundColor as string | undefined) ??
                  "#18232D"
                ).slice(0, 7)}
                onChange={(event) =>
                  update((target) => {
                    target.overrides = {
                      ...target.overrides,
                      backgroundColor: event.target.value,
                    };
                  })
                }
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">When unavailable</span>
            <select
              value={
                (item.overrides?.fallbackVisibility as string | undefined) ??
                "show"
              }
              onChange={(event) =>
                update((target) => {
                  target.overrides = {
                    ...target.overrides,
                    fallbackVisibility: event.target.value,
                  };
                })
              }
            >
              <option value="show">Show App fallback</option>
              <option value="hide">Hide placement</option>
            </select>
          </label>
          {(content?.widget?.provider === "website" ||
            content?.widget?.provider === "youtube") && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={(item.overrides?.muted as boolean | undefined) ?? true}
                onChange={(event) =>
                  update((target) => {
                    target.overrides = {
                      ...target.overrides,
                      muted: event.target.checked,
                    };
                  })
                }
              />
              Muted in this Layout
            </label>
          )}
          <button
            className="button button--secondary"
            onClick={() => {
              if (
                window.confirm(
                  `${content?.name ?? "This App"} may be used by other playlists and Layouts. Open the shared App editor?`,
                )
              )
                void navigate("/apps");
            }}
          >
            <AppWindow size={16} />
            Edit shared App
          </button>
        </div>
      )}
      {item.type === "playlistZone" && (
        <div className="layout-placement-settings">
          <div className="notice notice--neutral">
            <strong>{playlist?.name ?? item.name}</strong>
            <span>{playlist?.itemCount ?? 0} items</span>
          </div>
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Fit</span>
              <select
                value={item.playback?.fit ?? "contain"}
                onChange={(event) =>
                  update((target) => {
                    target.playback = {
                      ...target.playback,
                      fit: event.target.value as
                        "contain" | "cover" | "stretch",
                    };
                  })
                }
              >
                <option value="contain">Fit</option>
                <option value="cover">Fill</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Fallback</span>
              <select
                value={item.playback?.fallback ?? "background"}
                onChange={(event) =>
                  update((target) => {
                    target.playback = {
                      ...target.playback,
                      fallback: event.target.value as
                        "hide" | "background" | "previous",
                    };
                  })
                }
              >
                <option value="background">Zone background</option>
                <option value="previous">Previous item</option>
                <option value="hide">Hide zone</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={item.playback?.loop ?? true}
              onChange={(event) =>
                update((target) => {
                  target.playback = {
                    ...target.playback,
                    loop: event.target.checked,
                  };
                })
              }
            />
            Loop independently
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={item.playback?.muted ?? true}
              onChange={(event) =>
                update((target) => {
                  target.playback = {
                    ...target.playback,
                    muted: event.target.checked,
                  };
                })
              }
            />
            Muted
          </label>
          <NumberField
            label="Corner radius"
            value={item.playback?.cornerRadius ?? 0}
            max={1000}
            onChange={(value) =>
              update((target) => {
                target.playback = { ...target.playback, cornerRadius: value };
              })
            }
          />
          <button
            className="button button--secondary"
            onClick={() => void navigate(`/playlists/${item.playlistId}`)}
          >
            Edit playlist
          </button>
        </div>
      )}
      {item.type === "asset" && (
        <div className="layout-placement-settings">
          <label className="field">
            <span className="field__label">Fit</span>
            <select
              value={item.playback?.fit ?? "contain"}
              onChange={(event) =>
                update((target) => {
                  target.playback = {
                    ...target.playback,
                    fit: event.target.value as "contain" | "cover" | "stretch",
                  };
                })
              }
            >
              <option value="contain">Fit</option>
              <option value="cover">Fill</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>
          <div className="form-grid form-grid--2">
            <NumberField
              label="Corner radius"
              value={item.playback?.cornerRadius ?? 0}
              max={1000}
              onChange={(value) =>
                update((target) => {
                  target.playback = { ...target.playback, cornerRadius: value };
                })
              }
            />
            <label className="field">
              <span className="field__label">Fallback</span>
              <select
                value={item.playback?.fallback ?? "hide"}
                onChange={(event) =>
                  update((target) => {
                    target.playback = {
                      ...target.playback,
                      fallback: event.target.value as
                        "hide" | "background" | "previous",
                    };
                  })
                }
              >
                <option value="hide">Hide</option>
                <option value="background">Background</option>
                <option value="previous">Previous frame</option>
              </select>
            </label>
          </div>
          {content?.type === "video" && (
            <>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={item.playback?.muted ?? true}
                  onChange={(event) =>
                    update((target) => {
                      target.playback = {
                        ...target.playback,
                        muted: event.target.checked,
                      };
                    })
                  }
                />
                <span>Muted</span>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={item.playback?.loop ?? true}
                  onChange={(event) =>
                    update((target) => {
                      target.playback = {
                        ...target.playback,
                        loop: event.target.checked,
                      };
                    })
                  }
                />
                <span>Loop</span>
              </label>
            </>
          )}
        </div>
      )}
      {canGroup && (
        <button className="button button--secondary" onClick={group}>
          <Group size={16} />
          Group selection
        </button>
      )}
      {primitive?.kind === "group" && (
        <>
          <button className="button button--secondary" onClick={ungroup}>
            <Ungroup size={16} />
            Ungroup
          </button>
          <label className="field">
            <span className="field__label">Visibility</span>
            <select
              value={primitive.binding ? "field" : "always"}
              disabled={!primitive.binding && dataSources.length === 0}
              onChange={(event) =>
                update((target) => {
                  if (event.target.value === "always") {
                    delete target.primitive!.binding;
                    return;
                  }
                  const source = dataSources[0];
                  if (source)
                    target.primitive!.binding = {
                      dataSourceId: source.id,
                      field: structuredFields(source)[0] ?? "title",
                      hideWhenEmpty: true,
                    };
                })
              }
            >
              <option value="always">Always visible</option>
              <option value="field">Hide when field is empty</option>
            </select>
          </label>
          {primitive.binding && (
            <div className="form-grid form-grid--2">
              <label className="field">
                <span className="field__label">Data Source</span>
                <select
                  value={primitive.binding.dataSourceId}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.dataSourceId =
                          event.target.value),
                    )
                  }
                >
                  {dataSources.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Field</span>
                <select
                  value={primitive.binding.field}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.field = event.target.value),
                    )
                  }
                >
                  {structuredFields(
                    dataSources.find(
                      (asset) => asset.id === primitive.binding!.dataSourceId,
                    ),
                  ).map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </>
      )}
      {primitive?.kind === "text" && (
        <>
          <label className="field">
            <span className="field__label">Content mode</span>
            <select
              value={primitive.binding ? "dynamic" : "static"}
              onChange={(event) =>
                update((target) => {
                  if (event.target.value === "static") {
                    delete target.primitive!.binding;
                    return;
                  }
                  const source = dataSources[0];
                  if (source)
                    target.primitive!.binding = {
                      dataSourceId: source.id,
                      field: structuredFields(source)[0] ?? "title",
                      format: "text",
                    };
                })
              }
              disabled={!primitive.binding && dataSources.length === 0}
            >
              <option value="static">Static</option>
              <option value="dynamic">Dynamic field</option>
            </select>
          </label>
          {primitive.binding && (
            <div className="layout-placement-settings">
              <label className="field">
                <span className="field__label">Data Source</span>
                <select
                  value={primitive.binding.dataSourceId}
                  onChange={(event) =>
                    update((target) => {
                      const source = dataSources.find(
                        (asset) => asset.id === event.target.value,
                      );
                      target.primitive!.binding = {
                        ...target.primitive!.binding!,
                        dataSourceId: event.target.value,
                        field: source
                          ? (structuredFields(source)[0] ?? "title")
                          : "title",
                      };
                    })
                  }
                >
                  {dataSources.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Field</span>
                <select
                  value={primitive.binding.field}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.field = event.target.value),
                    )
                  }
                >
                  {structuredFields(
                    dataSources.find(
                      (asset) => asset.id === primitive.binding!.dataSourceId,
                    ),
                  ).map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Prefix</span>
                  <input
                    value={primitive.binding.prefix ?? ""}
                    onChange={(event) =>
                      update(
                        (target) =>
                          (target.primitive!.binding!.prefix =
                            event.target.value),
                      )
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Suffix</span>
                  <input
                    value={primitive.binding.suffix ?? ""}
                    onChange={(event) =>
                      update(
                        (target) =>
                          (target.primitive!.binding!.suffix =
                            event.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span className="field__label">Fallback text</span>
                <input
                  value={primitive.binding.fallbackText ?? ""}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.fallbackText =
                          event.target.value),
                    )
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Format</span>
                <select
                  value={primitive.binding.format ?? "text"}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.format = event.target
                          .value as NonNullable<
                          LayoutPrimitive["binding"]
                        >["format"]),
                    )
                  }
                >
                  <option value="text">Text</option>
                  <option value="date-short">Short date</option>
                  <option value="date-long">Long date</option>
                  <option value="number">Number</option>
                  <option value="integer">Integer</option>
                  <option value="currency">Currency</option>
                </select>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={primitive.binding.hideWhenEmpty ?? false}
                  onChange={(event) =>
                    update(
                      (target) =>
                        (target.primitive!.binding!.hideWhenEmpty =
                          event.target.checked),
                    )
                  }
                />
                <span>Hide when empty</span>
              </label>
            </div>
          )}
          {!primitive.binding && (
            <label className="field">
              <span className="field__label">Text</span>
              <textarea
                value={primitive.text ?? ""}
                onChange={(event) =>
                  update((target) => {
                    target.primitive!.text = event.target.value;
                  })
                }
              />
            </label>
          )}
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Font</span>
              <select
                value={primitive.fontFamily}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.fontFamily = event.target
                        .value as LayoutPrimitive["fontFamily"]),
                  )
                }
              >
                <option>Inter</option>
                <option>Roboto</option>
                <option>Source Sans 3</option>
                <option>Noto Sans</option>
              </select>
            </label>
            <NumberField
              label="Size"
              value={primitive.fontSize ?? 48}
              min={8}
              max={600}
              onChange={(value) =>
                update((target) => (target.primitive!.fontSize = value))
              }
            />
            <label className="field">
              <span className="field__label">Weight</span>
              <select
                value={primitive.fontWeight}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.fontWeight = Number(
                        event.target.value,
                      ) as LayoutPrimitive["fontWeight"]),
                  )
                }
              >
                {[400, 500, 600, 700, 800].map((weight) => (
                  <option key={weight}>{weight}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Align</span>
              <select
                value={primitive.textAlign}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.textAlign = event.target
                        .value as LayoutPrimitive["textAlign"]),
                  )
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Text color</span>
              <input
                type="color"
                value={primitive.color?.slice(0, 7)}
                onChange={(event) =>
                  update(
                    (target) => (target.primitive!.color = event.target.value),
                  )
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Background</span>
              <input
                type="color"
                value={(primitive.backgroundColor ?? "#000000").slice(0, 7)}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.backgroundColor = event.target.value),
                  )
                }
              />
            </label>
            <NumberField
              label="Line height"
              value={primitive.lineHeight ?? 1.2}
              min={0.8}
              max={3}
              step={0.1}
              onChange={(value) =>
                update((target) => (target.primitive!.lineHeight = value))
              }
            />
            <NumberField
              label="Letter spacing"
              value={primitive.letterSpacing ?? 0}
              min={0}
              max={40}
              step={0.5}
              onChange={(value) =>
                update((target) => (target.primitive!.letterSpacing = value))
              }
            />
            <NumberField
              label="Padding"
              value={primitive.padding ?? 0}
              max={300}
              onChange={(value) =>
                update((target) => (target.primitive!.padding = value))
              }
            />
            <NumberField
              label="Corner radius"
              value={primitive.cornerRadius ?? 0}
              max={1000}
              onChange={(value) =>
                update((target) => (target.primitive!.cornerRadius = value))
              }
            />
            <NumberField
              label="Border"
              value={primitive.borderWidth ?? 0}
              max={100}
              onChange={(value) =>
                update((target) => (target.primitive!.borderWidth = value))
              }
            />
            <NumberField
              label="Maximum lines"
              value={primitive.maximumLines ?? 4}
              min={1}
              max={100}
              onChange={(value) =>
                update((target) => (target.primitive!.maximumLines = value))
              }
            />
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={primitive.autoFit ?? false}
              onChange={(event) =>
                update(
                  (target) =>
                    (target.primitive!.autoFit = event.target.checked),
                )
              }
            />
            <span>Automatically fit text</span>
          </label>
        </>
      )}
      {primitive &&
        ["rectangle", "circle", "line"].includes(primitive.kind) && (
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Fill</span>
              <input
                type="color"
                value={(primitive.fillColor ?? "#2D7FF9").slice(0, 7)}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.fillColor = event.target.value),
                  )
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Stroke</span>
              <input
                type="color"
                value={(primitive.strokeColor ?? "#FFFFFF").slice(0, 7)}
                onChange={(event) =>
                  update(
                    (target) =>
                      (target.primitive!.strokeColor = event.target.value),
                  )
                }
              />
            </label>
            <NumberField
              label="Stroke width"
              value={primitive.strokeWidth ?? 0}
              max={100}
              onChange={(value) =>
                update((target) => (target.primitive!.strokeWidth = value))
              }
            />
          </div>
        )}
    </div>
  );
}

function structuredFields(source?: DataSource): string[] {
  if (!source || !["csv", "json"].includes(source.provider)) return [];
  const config = source.configuration as {
    mapping?: { valueFields?: Record<string, string> };
  };
  return [
    "title",
    "subtitle",
    "date",
    "author",
    "description",
    ...Object.keys(config.mapping?.valueFields ?? {}),
  ];
}
function CanvasInspector({
  document,
  update,
}: {
  document: LayoutDocument;
  update: (change: (draft: LayoutDocument) => void) => void;
}) {
  return (
    <div className="layout-inspector">
      <label className="field">
        <span className="field__label">Canvas preset</span>
        <select
          value={`${document.canvas.width}x${document.canvas.height}`}
          onChange={(event) => {
            const [width, height] = event.target.value.split("x").map(Number);
            update((draft) => {
              draft.canvas.width = width!;
              draft.canvas.height = height!;
              draft.canvas.orientation =
                width! > height! ? "landscape" : "portrait";
              draft.placements = draft.placements.filter(
                (item) =>
                  item.x + item.width <= width! &&
                  item.y + item.height <= height!,
              );
            });
          }}
        >
          <option value="1920x1080">1920 × 1080</option>
          <option value="1080x1920">1080 × 1920</option>
          <option value="3840x2160">3840 × 2160</option>
          <option value="2160x3840">2160 × 3840</option>
        </select>
      </label>
      <div className="form-grid form-grid--2">
        <NumberField
          label="Width"
          value={document.canvas.width}
          min={320}
          max={7680}
          onChange={(value) =>
            update((d) => {
              d.canvas.width = value;
              d.canvas.orientation = "custom";
            })
          }
        />
        <NumberField
          label="Height"
          value={document.canvas.height}
          min={320}
          max={7680}
          onChange={(value) =>
            update((d) => {
              d.canvas.height = value;
              d.canvas.orientation = "custom";
            })
          }
        />
      </div>
      <label className="field">
        <span className="field__label">Background</span>
        <input
          type="color"
          value={document.canvas.backgroundColor.slice(0, 7)}
          onChange={(event) =>
            update((d) => (d.canvas.backgroundColor = event.target.value))
          }
        />
      </label>
      <NumberField
        label="Safe area (%)"
        value={document.canvas.safeAreaPercent}
        min={0}
        max={20}
        step={1}
        onChange={(value) => update((d) => (d.canvas.safeAreaPercent = value))}
      />
      <div className="layout-canvas-summary">
        <AlignCenter size={17} />
        <span>
          {document.placements.length} layers · {document.canvas.orientation}
        </span>
      </div>
    </div>
  );
}
