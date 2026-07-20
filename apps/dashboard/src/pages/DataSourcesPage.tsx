import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  Select,
  ViewToggle,
} from "../components/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  Braces,
  CalendarDays,
  ClipboardList,
  Database,
  FileSpreadsheet,
  CloudSun,
  School,
  TableProperties,
  Check,
  Lightbulb,
  Plus,
  Rss,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { DataSourceDefinition, DataSourceProvider } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";
import { DataSourceEditor } from "../content/DataSourceEditors";
import { canManageContent } from "./ContentPage";
import { CreateFormDataSourcePage } from "./CreateFormDataSourcePage";
import { FormDataSourcePage } from "./FormDataSourcePage";

function providerLabel(provider: DataSourceProvider) {
  return (
    (
      {
        rss: "RSS",
        csv: "CSV",
        json: "JSON",
        manual: "Manual Table",
        cap_alerts: "CAP Alerts",
        air_quality: "Air Quality",
      } as Record<string, string>
    )[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

// A generic icon mapping by icon identifier. Release-defined definitions declare an icon
// name; unknown identifiers fall back to a safe default so a new definition never breaks
// the gallery.
const sourceIconMap: Record<string, LucideIcon> = {
  calendar: CalendarDays,
  csv: FileSpreadsheet,
  spreadsheet: FileSpreadsheet,
  json: Braces,
  braces: Braces,
  table: TableProperties,
  manual: TableProperties,
  cloud_sun: CloudSun,
  weather: CloudSun,
  rss: Rss,
  feed: Rss,
  alert: AlertTriangle,
  transit: CalendarDays,
  school: School,
};

export function iconForIdentifier(icon: string | undefined, size = 28) {
  const Icon = (icon && sourceIconMap[icon]) || Database;
  return <Icon size={size} />;
}

export type SetupCopy = {
  eyebrow: string;
  description: string;
  tip: string;
  steps: string[];
};

// resolveSetup returns the Studio setup copy for a Data Source. Release-defined sources use
// their catalog metadata (description and optional setup guidance); legacy providers keep
// their hardcoded editor copy.
export function resolveSetup(
  provider: DataSourceProvider,
  definition: DataSourceDefinition | undefined,
): SetupCopy {
  if (definition && !definition.legacyEditor) {
    return {
      eyebrow: definition.setup?.eyebrow ?? "Release-defined information",
      description: definition.description,
      tip: definition.setup?.tip ?? "",
      steps: definition.setup?.steps ?? [],
    };
  }
  return (
    createCopy[provider] ?? {
      eyebrow: definition?.category ?? "Data Source",
      description: definition?.description ?? "",
      tip: "",
      steps: [],
    }
  );
}

// sourceIcon prefers a release-defined definition's declared icon and falls back to the
// legacy provider icon.
export function sourceIcon(
  provider: DataSourceProvider,
  definition: DataSourceDefinition | undefined,
  size = 28,
) {
  if (definition && !definition.legacyEditor) {
    return iconForIdentifier(definition.icon, size);
  }
  return providerIcon(provider, size);
}

const createCopy: Record<string, SetupCopy> = {
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
  transit: {
    eyebrow: "Public transport",
    description:
      "Join public GTFS schedules with realtime trip updates and optional service alerts.",
    tip: "Use stable stop IDs from the agency’s GTFS Static feed.",
    steps: [
      "Enter the Static and Realtime feed URLs.",
      "Choose stop IDs, route filters, and timezone.",
      "Preview departures and alerts, then save.",
    ],
  },
  cap_alerts: {
    eyebrow: "Public warnings",
    description:
      "Normalize active public CAP 1.2 warnings from direct XML or a feed index.",
    tip: "Area filters match the alert’s published area description.",
    steps: [
      "Enter the CAP document or index URL.",
      "Choose language, severity, and area filters.",
      "Preview active alerts, then save.",
    ],
  },
  air_quality: {
    eyebrow: "Environmental conditions",
    description:
      "Cache current AQI and hourly pollutant forecasts for one location.",
    tip: "Hosted Open-Meteo access requires noncommercial acknowledgement; commercial deployments use a self-hosted endpoint.",
    steps: [
      "Enter the location coordinates and timezone.",
      "Choose AQI standard and measurements.",
      "Confirm endpoint policy, preview, then save.",
    ],
  },
};

function providerIcon(provider: DataSourceProvider, size = 28) {
  if (provider === "calendar") return <CalendarDays size={size} />;
  if (provider === "csv") return <FileSpreadsheet size={size} />;
  if (provider === "json") return <Braces size={size} />;
  if (provider === "manual") return <TableProperties size={size} />;
  if (provider === "weather") return <CloudSun size={size} />;
  if (provider === "air_quality") return <CloudSun size={size} />;
  if (provider === "transit") return <CalendarDays size={size} />;
  if (provider === "cap_alerts") return <Rss size={size} />;
  if (provider === "form") return <ClipboardList size={size} />;
  return <Rss size={size} />;
}

function DataSourceCreateShell({
  provider,
  definition,
  csrf,
  onClose,
  onSaved,
}: {
  provider: DataSourceProvider;
  definition?: DataSourceDefinition;
  csrf: string;
  onClose: () => void;
  onSaved: (value: { id: string }) => void;
}) {
  const copy = resolveSetup(provider, definition);
  const label =
    definition && !definition.legacyEditor
      ? definition.name
      : providerLabel(provider);
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
            {sourceIcon(provider, definition)}
          </span>
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>Create {label} Data Source</h2>
            <p>{copy.description}</p>
          </div>
        </div>
      </header>
      <div className="data-source-create-shell__layout">
        <aside
          className="data-source-create-shell__guide"
          aria-label="Data Source setup guidance"
        >
          {copy.steps.length > 0 && (
            <>
              <h3>Setup checklist</h3>
              <ol>
                {copy.steps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
          {copy.tip && (
            <div className="data-source-create-shell__tip">
              <Lightbulb size={17} />
              <div>
                <strong>Good to know</strong>
                <p>{copy.tip}</p>
              </div>
            </div>
          )}
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
  const catalog = useQuery({
    queryKey: ["provider-catalog"],
    queryFn: api.providerCatalog,
    staleTime: 5 * 60_000,
  });
  const sourceCount =
    catalog.data?.providers?.filter((entry) => entry.role === "data_source")
      .length ?? 0;
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
    staleTime: 5 * 60_000,
  });
  const releaseDefined =
    definitions.data?.dataSources?.filter(
      (definition) => !definition.legacyEditor,
    ) ?? [];
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
              compact, predictable setup pattern. {sourceCount || 7} typed
              projectors are available in the current server catalog.
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          {releaseDefined.map((definition) => (
            <button
              type="button"
              key={definition.id}
              onClick={() => onChoose(definition.id)}
            >
              {iconForIdentifier(definition.icon, 30)}
              <strong>{definition.name}</strong>
              <span>{definition.description}</span>
            </button>
          ))}
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
          <button type="button" onClick={() => onChoose("transit")}>
            <CalendarDays size={30} />
            <strong>Transit</strong>
            <span>Public GTFS departures and service alerts.</span>
          </button>
          <button type="button" onClick={() => onChoose("cap_alerts")}>
            <Rss size={30} />
            <strong>CAP Alerts</strong>
            <span>Active public emergency alerts and instructions.</span>
          </button>
          <button type="button" onClick={() => onChoose("air_quality")}>
            <CloudSun size={30} />
            <strong>Air Quality</strong>
            <span>Current AQI, pollutants, pollen, and hourly forecasts.</span>
          </button>
          <button type="button" onClick={() => onChoose("form")}>
            <ClipboardList size={30} />
            <strong>Form</strong>
            <span>
              Collect submissions, approve them, and publish records to Widgets.
            </span>
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
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
  });
  const definitionsByProvider = new Map<string, DataSourceDefinition>(
    (definitions.data?.dataSources ?? []).map((item) => [item.id, item]),
  );

  return (
    <section className="content-page apps-page">
      <PageHeader
        title="Data Sources"
        description="Reusable connections that fetch, parse, and cache data."
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => void navigate("/data-sources/new")}
            >
              <Plus size={16} aria-hidden="true" /> Create Data Source
            </Button>
          ) : undefined
        }
      />
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
          {(definitions.data?.dataSources ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <ViewToggle value={view} onValueChange={setView} />
      </DashboardListToolbar>
      {dataSources.isError && (
        <Notice variant="danger">
          {dataSources.error instanceof ApiError
            ? dataSources.error.message
            : "Data Sources could not be loaded."}
        </Notice>
      )}
      {dataSources.isLoading ? (
        <div className="table-loading">Loading Data Sources...</div>
      ) : dataSources.data?.items?.length === 0 ? (
        <EmptyState
          className="content-empty"
          icon={<Plus size={24} aria-hidden="true" />}
          title="No Data Sources yet"
          message="Create a reusable connection to feed your Widgets."
          action={
            canManage ? (
              <Button
                variant="primary"
                onClick={() => void navigate("/data-sources/new")}
              >
                Create Data Source
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={`asset-collection asset-collection--${view}`}>
          {dataSources.data?.items?.map((source) => (
            <article className="asset-card" key={source.id}>
              <button
                className="asset-card__open"
                onClick={() => void navigate(`/data-sources/${source.id}`)}
                aria-label={`Edit ${source.name}`}
              >
                <span className="asset-preview">
                  {sourceIcon(
                    source.provider,
                    definitionsByProvider.get(source.provider),
                  )}
                </span>
                <span className="asset-card__body">
                  <strong>{source.name}</strong>
                  <small>
                    {definitionsByProvider.get(source.provider)?.name ??
                      providerLabel(source.provider)}{" "}
                    · {source.cachedRecordCount} cached records
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
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
  });
  const dataSource = detail.data;
  const provider = providerParam ?? dataSource?.provider;
  const close = () => void navigate("/data-sources");
  const saved = (value: { id: string }) => {
    void navigate(`/data-sources/${value.id}`, { replace: true });
  };
  const definition = definitions.data?.dataSources?.find(
    (candidate) => candidate.id === provider,
  );

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
  // Form Data Sources use a dedicated, full-width management page rather than the compact generic
  // editor shell, and enforce per-form capabilities instead of only global roles.
  if (provider === "form") {
    return dataSource ? (
      <FormDataSourcePage dataSource={dataSource} />
    ) : (
      <CreateFormDataSourcePage />
    );
  }
  if (definitions.isLoading)
    return (
      <div className="table-loading">Loading Data Source definition...</div>
    );
  if ((id && !dataSource) || !provider || !definition) {
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
          definition={definition}
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
