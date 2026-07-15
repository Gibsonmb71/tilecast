import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import type { LayoutOrientation } from "../api/types";

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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState(0);
  const layouts = useQuery({
    queryKey: ["layouts", search],
    queryFn: () => api.layouts(search),
  });
  const create = useMutation({
    mutationFn: () =>
      api.createLayout(
        {
          name,
          description,
          orientation: presets[preset]!.orientation,
          canvasWidth: presets[preset]!.width,
          canvasHeight: presets[preset]!.height,
        },
        csrf,
      ),
    onSuccess: (layout) => {
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
      void navigate(`/layouts/${layout.id}`);
    },
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateLayout(id, csrf),
    onSuccess: (layout) => {
      void queryClient.invalidateQueries({ queryKey: ["layouts"] });
      void navigate(`/layouts/${layout.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteLayout(id, csrf),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["layouts"] }),
  });
  return (
    <section className="layouts-page">
      <header className="content-header layouts-header">
        <div>
          <h2>Layouts</h2>
          <p>
            Compose complete screen presentations from native primitives and
            reusable Content.
          </p>
        </div>
        <button
          className="button button--primary"
          onClick={() => setCreating(true)}
        >
          <Plus size={17} />
          New Layout
        </button>
      </header>
      <div className="toolbar layouts-list-toolbar">
        <label className="search-control">
          <span className="sr-only">Search Layouts</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Layouts"
          />
        </label>
      </div>
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
                <LayoutTemplate size={28} />
                <span>
                  {layout.canvasWidth} × {layout.canvasHeight}
                </span>
              </button>
              <div className="layout-library-item__copy">
                <strong>{layout.name}</strong>
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
        <div className="empty-state">
          <LayoutTemplate size={34} />
          <h2>No Layouts yet</h2>
          <p>
            Create a landscape or portrait canvas and build the presentation
            directly.
          </p>
          <button
            className="button button--primary"
            onClick={() => setCreating(true)}
          >
            Create Layout
          </button>
        </div>
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
            </div>
            <footer>
              <button
                className="button button--secondary"
                onClick={() => setCreating(false)}
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
