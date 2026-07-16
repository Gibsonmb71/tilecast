import { Select } from "../components/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Braces,
  CalendarDays,
  FileSpreadsheet,
  CloudSun,
  TableProperties,
  Check,
  Grid2X2,
  Lightbulb,
  List,
  Plus,
  Rss,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { DataSourceProvider } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";
import { DataSourceEditor } from "../content/DataSourceEditors";
import { canManageContent } from "./ContentPage";

const providers: DataSourceProvider[] = [
  "calendar",
  "rss",
  "atom",
  "json",
  "csv",
  "manual",
  "weather",
];

function providerLabel(provider: DataSourceProvider) {
  return (
    (
      {
        rss: "RSS",
        csv: "CSV",
        json: "JSON",
        manual: "Manual Table",
      } as Record<string, string>
    )[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

const createCopy: Record<
  DataSourceProvider,
  { eyebrow: string; description: string; tip: string; steps: string[] }
> = {
  calendar: {
    eyebrow: "iCalendar feed",
    description:
      "Connect one or more public ICS calendars, choose which event details to expose, then preview real events before saving.",
    tip: "Use the public or secret iCalendar subscription URL, not the normal calendar webpage.",
    steps: [
      "Name the connection and paste the public ICS URL.",
      "Choose the event window, fields, and timezone.",
      "Preview real events, then save the Data Source.",
    ],
  },
  rss: {
    eyebrow: "News and updates",
    description:
      "Turn an RSS feed into clean, cached records for lists, tickers, tables, and layouts.",
    tip: "Paste the direct feed URL. It often ends in /feed, .xml, or .rss.",
    steps: [
      "Name the connection and paste the RSS feed URL.",
      "Choose the fields, item limit, and sort order.",
      "Preview the mapped posts, then save.",
    ],
  },
  atom: {
    eyebrow: "Published entries",
    description:
      "Turn an Atom feed into reusable records without making editors work through every technical option first.",
    tip: "Use the direct Atom XML URL rather than the website homepage.",
    steps: [
      "Name the connection and paste the Atom feed URL.",
      "Choose the fields, item limit, and sort order.",
      "Preview the mapped entries, then save.",
    ],
  },
  json: {
    eyebrow: "Structured API data",
    description:
      "Connect a public JSON endpoint, map its record paths, and verify the normalized result before saving.",
    tip: 'JSON Pointer paths begin with a slash. Use / for a top-level array or /items for { "items": [...] }.',
    steps: [
      "Paste the public JSON endpoint URL.",
      "Map the list path and the fields your Widgets need.",
      "Preview the mapped records, then save.",
    ],
  },
  csv: {
    eyebrow: "Spreadsheet data",
    description:
      "Upload a CSV or connect a hosted CSV, map its columns, and preview the rows Tilecast will cache.",
    tip: "Column names must match the first row of the CSV. Start with the title column; the others are optional.",
    steps: [
      "Upload a CSV file or paste a direct CSV URL.",
      "Map the column names and choose displayed fields.",
      "Preview the mapped rows, then save.",
    ],
  },
  manual: {
    eyebrow: "Editor-managed data",
    description:
      "Create a small typed table for announcements, prices, metrics, directories, and other reusable signage data.",
    tip: "Choose stable field keys because Widgets refer to them when selecting content.",
    steps: [
      "Define the typed columns your Widgets need.",
      "Enter up to 200 rows directly in Studio.",
      "Save and reuse the table across multiple Widgets.",
    ],
  },
  weather: {
    eyebrow: "Global forecast",
    description:
      "Cache current conditions and a seven-day forecast for one coordinate using MET Norway.",
    tip: "Use coordinates rounded to four decimals and the IANA timezone for the location.",
    steps: [
      "Enter the location label, coordinates, and timezone.",
      "Choose units and provide the required contact identity.",
      "Preview the normalized forecast, then save.",
    ],
  },
};

function providerIcon(provider: DataSourceProvider, size = 28) {
  if (provider === "calendar") return <CalendarDays size={size} />;
  if (provider === "csv") return <FileSpreadsheet size={size} />;
  if (provider === "json") return <Braces size={size} />;
  if (provider === "manual") return <TableProperties size={size} />;
  if (provider === "weather") return <CloudSun size={size} />;
  return <Rss size={size} />;
}

function DataSourceCreateShell({
  provider,
  csrf,
  onClose,
  onSaved,
}: {
  provider: DataSourceProvider;
  csrf: string;
  onClose: () => void;
  onSaved: (value: { id: string }) => void;
}) {
  const copy = createCopy[provider];
  return (
    <div
      className={`data-source-create-shell data-source-create-shell--${provider}`}
    >
      <header className="data-source-create-shell__header">
        <button
          className="button button--quiet"
          type="button"
          onClick={onClose}
        >
          <ArrowLeft size={16} /> Data Sources
        </button>
        <div>
          <span className="data-source-create-shell__icon">
            {providerIcon(provider)}
          </span>
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>Create {providerLabel(provider)} Data Source</h2>
            <p>{copy.description}</p>
          </div>
        </div>
      </header>
      <div className="data-source-create-shell__layout">
        <aside
          className="data-source-create-shell__guide"
          aria-label="Data Source setup guidance"
        >
          <h3>Setup checklist</h3>
          <ol>
            {copy.steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
          <div className="data-source-create-shell__tip">
            <Lightbulb size={17} />
            <div>
              <strong>Good to know</strong>
              <p>{copy.tip}</p>
            </div>
          </div>
          <p className="data-source-create-shell__advanced-note">
            <Check size={15} /> Advanced filtering and cache controls are
            optional.
          </p>
        </aside>
        <div className="data-source-create-shell__editor">
          <DataSourceEditor
            provider={provider}
            csrf={csrf}
            onClose={onClose}
            onSaved={onSaved}
            page
          />
        </div>
      </div>
    </div>
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
            <p>
              Choose what you are connecting. Every provider uses the same
              compact, predictable setup pattern.
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          <button type="button" onClick={() => onChoose("calendar")}>
            <CalendarDays size={30} />
            <strong>Calendar</strong>
            <span>
              Public Google, Microsoft, Apple, or other ICS calendars.
            </span>
          </button>
          <button type="button" onClick={() => onChoose("rss")}>
            <Rss size={30} />
            <strong>RSS</strong>
            <span>News, announcements, blog posts, and published updates.</span>
          </button>
          <button type="button" onClick={() => onChoose("atom")}>
            <Rss size={30} />
            <strong>Atom</strong>
            <span>Atom entries from publishing systems and update feeds.</span>
          </button>
          <button type="button" onClick={() => onChoose("json")}>
            <Braces size={30} />
            <strong>JSON</strong>
            <span>Public API data mapped with simple JSON Pointer paths.</span>
          </button>
          <button type="button" onClick={() => onChoose("csv")}>
            <FileSpreadsheet size={30} />
            <strong>CSV</strong>
            <span>
              Upload a spreadsheet export or connect a hosted CSV URL.
            </span>
          </button>
          <button type="button" onClick={() => onChoose("manual")}>
            <TableProperties size={30} />
            <strong>Manual Table</strong>
            <span>Maintain a small typed dataset directly in Studio.</span>
          </button>
          <button type="button" onClick={() => onChoose("weather")}>
            <CloudSun size={30} />
            <strong>Weather</strong>
            <span>Cached current conditions and daily forecasts.</span>
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
      <DashboardListToolbar>
        <DashboardSearch
          value={search}
          onValueChange={setSearch}
          label="Search Data Sources"
          placeholder="Search Data Sources"
        />
        <Select
          className="dashboard-list-toolbar__filter"
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
        </Select>
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
      </DashboardListToolbar>
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
                  {providerIcon(source.provider)}
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
      {dataSource ? (
        <DataSourceEditor
          provider={provider}
          dataSource={dataSource}
          csrf={csrf}
          readOnly={!canManageContent(auth.status?.user)}
          onClose={close}
          onSaved={saved}
          page
        />
      ) : canManageContent(auth.status?.user) ? (
        <DataSourceCreateShell
          provider={provider}
          csrf={csrf}
          onClose={close}
          onSaved={saved}
        />
      ) : (
        <section className="empty-state">
          <h2>You do not have permission to create Data Sources</h2>
          <button className="button" onClick={close}>
            Back to Data Sources
          </button>
        </section>
      )}
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
