import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  Select,
} from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client";
import type { LayoutOrientation } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { LayoutThumbnail } from "../components/LayoutThumbnail";
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";

const presets = [
  {
    label: "Full HD landscape",
    orientation: "landscape" as const,
    width: 1920,
    height: 1080,
  },
  {
    label: "Full HD portrait",
    orientation: "portrait" as const,
    width: 1080,
    height: 1920,
  },
  {
    label: "4K landscape",
    orientation: "landscape" as const,
    width: 3840,
    height: 2160,
  },
  {
    label: "4K portrait",
    orientation: "portrait" as const,
    width: 2160,
    height: 3840,
  },
];

export function LayoutsPage() {
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState(0);
  const [template, setTemplate] = useState<"blank" | "announcement">("blank");
  const [actionError, setActionError] = useState("");
  const layouts = useQuery({
    queryKey: ["layouts", search],
    queryFn: () => api.layouts(search),
  });
  const create = useMutation({
    mutationFn: async () => {
      const created = await api.createLayout(
        {
          name,
          description,
          orientation: presets[preset]!.orientation,
          canvasWidth: presets[preset]!.width,
          canvasHeight: presets[preset]!.height,
        },
        csrf,
      );
      if (template === "blank") return created;
      const document = structuredClone(created.draft);
      document.placements.push(
        {
          id: crypto.randomUUID(),
          type: "primitive",
          name: "Accent",
          x: 0,
          y: 0,
          width: Math.max(24, document.canvas.width * 0.025),
          height: document.canvas.height,
          layer: 1,
          opacity: 1,
          visible: true,
          locked: false,
          primitive: { kind: "rectangle", fillColor: "#2D7FF9" },
        },
        {
          id: crypto.randomUUID(),
          type: "primitive",
          name: "Headline",
          x: document.canvas.width * 0.1,
          y: document.canvas.height * 0.24,
          width: document.canvas.width * 0.8,
          height: document.canvas.height * 0.5,
          layer: 2,
          opacity: 1,
          visible: true,
          locked: false,
          primitive: {
            kind: "text",
            text: "Announcement",
            fontFamily: "Inter",
            fontSize: 112,
            fontWeight: 700,
            textAlign: "left",
            verticalAlign: "center",
            color: "#F5F7FA",
            backgroundColor: "#00000000",
            lineHeight: 1.1,
            maximumLines: 3,
            overflow: "ellipsis",
          },
        },
      );
      return api.saveLayoutDraft(
        created.id,
        created.draftRevision,
        document,
        csrf,
      );
    },
    onSuccess: (layout) => {
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
      void navigate(`/layouts/${layout.id}`);
    },
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateLayout(id, csrf),
    onMutate: () => setActionError(""),
    onSuccess: (layout) => {
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
      void navigate(`/layouts/${layout.id}`);
    },
    onError: (error) =>
      setActionError(
        error instanceof Error
          ? error.message
          : "The Layout could not be duplicated.",
      ),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteLayout(id, csrf),
    onMutate: () => setActionError(""),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["layouts"] }),
    onError: (error) =>
      setActionError(
        error instanceof Error
          ? error.message
          : "The Layout could not be deleted because it is still in use.",
      ),
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
    <section className="layouts-page">
      <PageHeader
        title="Layouts"
        description="Compose complete screen presentations from native primitives and reusable Content."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={17} aria-hidden="true" />
            New Layout
          </Button>
        }
      />
      <DashboardListToolbar>
        <DashboardSearch
          value={search}
          onValueChange={setSearch}
          label="Search Layouts"
          placeholder="Search Layouts"
        />
      </DashboardListToolbar>
      {actionError && <Notice variant="danger">{actionError}</Notice>}
      {layouts.isLoading ? (
        <p className="status-copy">Loading Layouts…</p>
      ) : layouts.data?.items.length ? (
        <div className="layout-library">
          {layouts.data.items.map((layout) => (
            <article className="layout-library-item" key={layout.id}>
              <button
                className="layout-library-item__preview"
                onClick={() => void navigate(`/layouts/${layout.id}`)}
                style={{
                  aspectRatio: `${layout.canvasWidth}/${layout.canvasHeight}`,
                }}
                aria-label={`Edit ${layout.name}`}
              >
                <LayoutThumbnail layoutId={layout.id} name={layout.name} />
                <span className="layout-library-item__dimensions">
                  {layout.canvasWidth} × {layout.canvasHeight}
                </span>
              </button>
              <div className="layout-library-item__copy">
                <strong title={layout.name}>{layout.name}</strong>
                <span>
                  {layout.orientation} ·{" "}
                  {layout.publishedRevision
                    ? `Published r${layout.publishedRevision}`
                    : "Draft only"}
                </span>
              </div>
              <div className="layout-library-item__actions">
                <button
                  className="icon-button"
                  title="Duplicate"
                  aria-label={`Duplicate ${layout.name}`}
                  onClick={() => duplicate.mutate(layout.id)}
                >
                  <Copy size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Delete"
                  aria-label={`Delete ${layout.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${layout.name}?`))
                      remove.mutate(layout.id);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<LayoutTemplate size={24} aria-hidden="true" />}
          title="No Layouts yet"
          message="Create a landscape or portrait canvas and build the presentation directly."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create Layout
            </Button>
          }
        />
      )}
      {creating && (
        <div className="details-backdrop" role="presentation">
          <section
            className="asset-details layout-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-layout-title"
          >
            <header>
              <div>
                <h2 id="create-layout-title">Create Layout</h2>
                <p>
                  Choose a canvas preset. Dimensions remain editable in the
                  editor.
                </p>
              </div>
            </header>
            <div className="source-editor__body">
              <label className="field">
                <span className="field__label">Name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Description</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div className="layout-preset-grid">
                {presets.map((item, index) => (
                  <button
                    className={preset === index ? "is-selected" : ""}
                    key={item.label}
                    onClick={() => setPreset(index)}
                  >
                    <span
                      className={`layout-preset-shape layout-preset-shape--${item.orientation}`}
                    />
                    <strong>{item.label}</strong>
                    <small>
                      {item.width} × {item.height}
                    </small>
                  </button>
                ))}
              </div>
              <label className="field">
                <span className="field__label">Starting point</span>
                <Select
                  value={template}
                  onChange={(event) =>
                    setTemplate(event.target.value as "blank" | "announcement")
                  }
                >
                  <option value="blank">Blank canvas</option>
                  <option value="announcement">Announcement</option>
                </Select>
              </label>
            </div>
            <footer>
              <button
                className="button button--secondary"
                onClick={closeCreate}
              >
                Cancel
              </button>
              <button
                className="button button--primary"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create Layout"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}

export const layoutPresets: {
  label: string;
  orientation: LayoutOrientation;
  width: number;
  height: number;
}[] = presets;
