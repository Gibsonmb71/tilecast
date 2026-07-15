import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid2X2, List, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { Asset, SourceProvider } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  CalendarSourceEditor,
  NativeAppEditor,
  SourceProviderGallery,
  StructuredSourceEditor,
  YouTubeSourceEditor,
} from "../content/SourceEditors";
import {
  AssetCollection,
  WebsiteEditor,
  canManageContent,
} from "./ContentPage";

const providers: SourceProvider[] = [
  "website",
  "youtube",
  "calendar",
  "rss",
  "atom",
  "json",
  "csv",
  "clock",
  "date",
  "qrcode",
  "ticker",
  "menu",
  "list",
  "table",
  "agenda",
];

export function AppsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";
  const canManage = canManageContent(auth.status?.user);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const params = new URLSearchParams({
    page: "1",
    pageSize: "100",
    type: "source",
  });
  if (search) params.set("search", search);
  if (provider) params.set("provider", provider);
  const apps = useQuery({
    queryKey: ["assets", "apps", params.toString()],
    queryFn: () => api.assets(params),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateSource(id, csrf),
    onSuccess: (app) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void navigate(`/apps/${app.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAsset(id, csrf),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <section className="content-page apps-page">
      <header className="page-heading">
        <div>
          <h2>Apps</h2>
          <p>Reusable dynamic signage content for playlists and Layouts.</p>
        </div>
        {canManage && (
          <button
            className="button button--primary"
            onClick={() => void navigate("/apps/new")}
          >
            <Plus size={16} /> Create App
          </button>
        )}
      </header>
      <div className="content-toolbar">
        <label className="search-control">
          <Search size={15} />
          <span className="visually-hidden">Search Apps</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Apps"
          />
        </label>
        <select
          aria-label="Filter by App provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">All App types</option>
          {providers.map((item) => (
            <option key={item} value={item}>
              {providerLabel(item)}
            </option>
          ))}
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
      {apps.isError && (
        <div className="notice notice--error">
          {apps.error instanceof ApiError
            ? apps.error.message
            : "Apps could not be loaded."}
        </div>
      )}
      {apps.isLoading ? (
        <div className="table-loading">Loading Apps...</div>
      ) : apps.data?.items.length === 0 ? (
        <div className="content-empty">
          <Plus size={30} />
          <h3>No Apps yet</h3>
          <p>Create a reusable App for dynamic or data-driven signage.</p>
          {canManage && (
            <button
              className="button button--primary"
              onClick={() => void navigate("/apps/new")}
            >
              Create App
            </button>
          )}
        </div>
      ) : (
        <AssetCollection
          items={apps.data?.items ?? []}
          view={view}
          onSelect={(app) => void navigate(`/apps/${app.id}`)}
          canManage={canManage}
          onDuplicate={(app) => duplicate.mutate(app.id)}
          onDelete={(app) => {
            if (confirm(`Delete ${app.name}?`)) remove.mutate(app.id);
          }}
        />
      )}
    </section>
  );
}

export function AppEditorPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { id, provider: providerParam } = useParams();
  const csrf = auth.status?.csrfToken ?? "";
  const app = useQuery({
    queryKey: ["assets", id],
    queryFn: () => api.asset(id!),
    enabled: Boolean(id),
  });
  const asset = app.data;
  const provider = (providerParam ?? asset?.source?.provider) as
    SourceProvider | undefined;
  const close = () => void navigate("/apps");
  const saved = (value: Asset) => {
    void navigate(`/apps/${value.id}`, { replace: true });
  };

  if (!id && !providerParam) {
    return (
      <section className="app-editor-route">
        <SourceProviderGallery
          page
          onClose={close}
          onChoose={(choice) => void navigate(`/apps/new/${choice}`)}
        />
      </section>
    );
  }
  if (id && app.isLoading)
    return <div className="table-loading">Loading App...</div>;
  if ((id && !asset) || !provider || !providers.includes(provider)) {
    return (
      <section className="empty-state">
        <h2>App unavailable</h2>
        <button className="button" onClick={close}>
          Back to Apps
        </button>
      </section>
    );
  }
  const common = {
    asset,
    csrf,
    page: true,
    readOnly: !canManageContent(auth.status?.user),
    onClose: close,
    onSaved: saved,
  };
  return (
    <section className="app-editor-route">
      {provider === "website" ? (
        <WebsiteEditor {...common} />
      ) : provider === "youtube" ? (
        <YouTubeSourceEditor {...common} />
      ) : provider === "calendar" ? (
        <CalendarSourceEditor {...common} />
      ) : ["rss", "atom", "json", "csv"].includes(provider) ? (
        <StructuredSourceEditor
          {...common}
          provider={provider as "rss" | "atom" | "json" | "csv"}
        />
      ) : (
        <NativeAppEditor
          {...common}
          provider={
            provider as
              | "clock"
              | "date"
              | "qrcode"
              | "ticker"
              | "menu"
              | "list"
              | "table"
              | "agenda"
          }
        />
      )}
    </section>
  );
}

function providerLabel(provider: SourceProvider) {
  return (
    (
      {
        qrcode: "QR Code",
        rss: "RSS",
        csv: "CSV",
        json: "JSON",
        youtube: "YouTube",
      } as Record<string, string>
    )[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}
