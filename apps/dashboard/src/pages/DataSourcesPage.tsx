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
  Braces,
  CalendarDays,
  ClipboardList,
  FileSpreadsheet,
  CloudSun,
  TableProperties,
  Check,
  Lightbulb,
  Plus,
  Rss,
  X,
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
import {
  iconForIdentifier,
  providerLabel,
  resolveSetup,
  sourceIcon,
} from "../content/dataSourceProviderMeta";
import { canManageContent } from "./ContentPage";
import { CreateFormDataSourcePage } from "./CreateFormDataSourcePage";
import { FormDataSourcePage } from "./FormDataSourcePage";

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
