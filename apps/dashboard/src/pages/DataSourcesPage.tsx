import { useQuery } from "@tanstack/react-query";
import {
  Braces,
  CalendarDays,
  FileSpreadsheet,
  Grid2X2,
  List,
  Plus,
  Rss,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { DataSourceProvider } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { DataSourceEditor } from "../content/DataSourceEditors";
import { canManageContent } from "./ContentPage";

const providers: DataSourceProvider[] = [
  "calendar",
  "rss",
  "atom",
  "json",
  "csv",
];

function providerLabel(provider: DataSourceProvider) {
  return (
    ({ rss: "RSS", csv: "CSV", json: "JSON" } as Record<string, string>)[
      provider
    ] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

function DataSourceProviderGallery({
  onChoose,
  onClose,
  page = false,
}: {
  onChoose: (provider: DataSourceProvider) => void;
  onClose: () => void;
  page?: boolean;
}) {
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="source-gallery"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="data-source-gallery-title"
      >
        <header>
          <div>
            <h2 id="data-source-gallery-title">Create Data Source</h2>
            <p>Choose a built-in Data Source provider.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          <button type="button" onClick={() => onChoose("calendar")}>
            <CalendarDays size={30} />
            <strong>Calendar</strong>
            <span>Fetch and cache events from an ICS feed URL.</span>
          </button>
          <button type="button" onClick={() => onChoose("rss")}>
            <Rss size={30} />
            <strong>RSS</strong>
            <span>Fetch and cache posts from an RSS feed.</span>
          </button>
          <button type="button" onClick={() => onChoose("atom")}>
            <Rss size={30} />
            <strong>Atom</strong>
            <span>Fetch and cache entries from an Atom feed.</span>
          </button>
          <button type="button" onClick={() => onChoose("json")}>
            <Braces size={30} />
            <strong>JSON</strong>
            <span>
              Map a public JSON array using constrained JSON Pointers.
            </span>
          </button>
          <button type="button" onClick={() => onChoose("csv")}>
            <FileSpreadsheet size={30} />
            <strong>CSV</strong>
            <span>Map a hosted or uploaded UTF-8 CSV file.</span>
          </button>
        </div>
      </section>
    </div>
  );
}

export function DataSourcesPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const canManage = canManageContent(auth.status?.user);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const params = new URLSearchParams({ page: "1", pageSize: "100" });
  if (search) params.set("search", search);
  if (provider) params.set("provider", provider);
  const dataSources = useQuery({
    queryKey: ["data-sources", params.toString()],
    queryFn: () => api.listDataSources(params),
  });

  return (
    <section className="content-page apps-page">
      <header className="page-heading">
        <div>
          <h2>Data Sources</h2>
          <p>Reusable connections that fetch, parse, and cache data.</p>
        </div>
        {canManage && (
          <button
            className="button button--primary"
            onClick={() => void navigate("/data-sources/new")}
          >
            <Plus size={16} /> Create Data Source
          </button>
        )}
      </header>
      <div className="content-toolbar">
        <label className="search-control">
          <Search size={15} />
          <span className="visually-hidden">Search Data Sources</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Data Sources"
          />
        </label>
        <select
          aria-label="Filter by Data Source provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">All Data Source types</option>
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
      {dataSources.isError && (
        <div className="notice notice--error">
          {dataSources.error instanceof ApiError
            ? dataSources.error.message
            : "Data Sources could not be loaded."}
        </div>
      )}
      {dataSources.isLoading ? (
        <div className="table-loading">Loading Data Sources...</div>
      ) : dataSources.data?.items.length === 0 ? (
        <div className="content-empty">
          <Plus size={30} />
          <h3>No Data Sources yet</h3>
          <p>Create a reusable connection to feed your Widgets.</p>
          {canManage && (
            <button
              className="button button--primary"
              onClick={() => void navigate("/data-sources/new")}
            >
              Create Data Source
            </button>
          )}
        </div>
      ) : (
        <div className={`asset-collection asset-collection--${view}`}>
          {dataSources.data?.items.map((source) => (
            <article className="asset-card" key={source.id}>
              <button
                className="asset-card__open"
                onClick={() => void navigate(`/data-sources/${source.id}`)}
                aria-label={`Edit ${source.name}`}
              >
                <span className="asset-preview">
                  {source.provider === "calendar" ? (
                    <CalendarDays size={28} />
                  ) : source.provider === "csv" ? (
                    <FileSpreadsheet size={28} />
                  ) : source.provider === "json" ? (
                    <Braces size={28} />
                  ) : (
                    <Rss size={28} />
                  )}
                </span>
                <span className="asset-card__body">
                  <strong>{source.name}</strong>
                  <small>
                    {providerLabel(source.provider)} ·{" "}
                    {source.cachedRecordCount} cached records
                  </small>
                </span>
                <span
                  className={`media-status media-status--${source.status === "ready" ? "ready" : source.status === "error" ? "failed" : "processing"}`}
                >
                  {source.status}
                </span>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function DataSourceEditorPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { id, provider: providerParam } = useParams();
  const csrf = auth.status?.csrfToken ?? "";
  const detail = useQuery({
    queryKey: ["data-source", id],
    queryFn: () => api.getDataSource(id!),
    enabled: Boolean(id),
  });
  const dataSource = detail.data;
  const provider = (providerParam ?? dataSource?.provider) as
    DataSourceProvider | undefined;
  const close = () => void navigate("/data-sources");
  const saved = (value: { id: string }) => {
    void navigate(`/data-sources/${value.id}`, { replace: true });
  };

  if (!id && !providerParam) {
    return (
      <section className="app-editor-route">
        <DataSourceProviderGallery
          page
          onClose={close}
          onChoose={(choice) => void navigate(`/data-sources/new/${choice}`)}
        />
      </section>
    );
  }
  if (id && detail.isLoading)
    return <div className="table-loading">Loading Data Source...</div>;
  if ((id && !dataSource) || !provider || !providers.includes(provider)) {
    return (
      <section className="empty-state">
        <h2>Data Source unavailable</h2>
        <button className="button" onClick={close}>
          Back to Data Sources
        </button>
      </section>
    );
  }
  return (
    <section className="app-editor-route">
      <DataSourceEditor
        provider={provider}
        dataSource={dataSource}
        csrf={csrf}
        readOnly={!canManageContent(auth.status?.user)}
        onClose={close}
        onSaved={saved}
        page
      />
      {dataSource && (
        <aside className="source-diagnostics">
          <strong>Usage</strong>
          <p>
            {dataSource.widgetUsage.length} Widget
            {dataSource.widgetUsage.length === 1 ? "" : "s"} ·{" "}
            {dataSource.bindingUsage.length} Layout text binding
            {dataSource.bindingUsage.length === 1 ? "" : "s"}
          </p>
          {dataSource.widgetUsage.length > 0 && (
            <ul>
              {dataSource.widgetUsage.map((usage) => (
                <li key={usage.id}>{usage.name}</li>
              ))}
            </ul>
          )}
          {dataSource.bindingUsage.length > 0 && (
            <ul>
              {dataSource.bindingUsage.map((usage) => (
                <li key={`${usage.layoutId}-${usage.field}`}>
                  {usage.layoutName} ({usage.field})
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </section>
  );
}
