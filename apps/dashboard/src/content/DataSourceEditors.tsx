import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import type {
  CalendarConfig,
  CalendarPreview,
  DataSourceDetail,
  DataSourceProvider,
  StructuredPreview,
  StructuredSourceConfig,
} from "../api/types";

export type StructuredProvider = "rss" | "atom" | "json" | "csv";

const defaultStructured = (
  provider: StructuredProvider,
): StructuredSourceConfig => ({
  url: "https://",
  presentation: provider === "rss" || provider === "atom" ? "list" : "cards",
  maxItems: 20,
  fields: {
    title: true,
    subtitle: true,
    date: true,
    author: true,
    description: true,
    image: false,
    link: false,
  },
  filterKeyword: "",
  sort: "newest",
  ...(provider === "json"
    ? {
        mapping: {
          rootList: "/items",
          title: "/title",
          subtitle: "/subtitle",
          date: "/date",
          imageUrl: "/image",
          link: "/link",
        },
      }
    : {}),
  ...(provider === "csv"
    ? {
        mapping: {
          rootList: "",
          title: "title",
          subtitle: "subtitle",
          date: "date",
          imageUrl: "image",
          link: "link",
        },
        delimiter: "" as const,
      }
    : {}),
  filters: [],
  refreshIntervalSeconds: 900,
  stalenessLimitHours: 168,
  emptyState: "No items available",
  dateSelection: {
    enabled: false,
    dateFormat: "auto",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    mode: "today",
    excludePast: false,
    noMatchBehavior: "empty",
  },
});

export function StructuredDataSourceEditor({
  provider,
  dataSource,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
  page = false,
}: {
  provider: StructuredProvider;
  dataSource?: DataSourceDetail;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (dataSource: DataSourceDetail) => void;
  page?: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(dataSource?.name ?? "");
  const [description, setDescription] = useState(dataSource?.description ?? "");
  const configured = dataSource?.configuration as
    StructuredSourceConfig | undefined;
  const defaults = defaultStructured(provider);
  const [configuration, setConfiguration] = useState<StructuredSourceConfig>({
    ...defaults,
    ...configured,
    dateSelection: {
      ...defaults.dateSelection,
      ...configured?.dateSelection,
    },
  });
  const [preview, setPreview] = useState<StructuredPreview>();
  const [previewDate, setPreviewDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const diagnostics = useQuery({
    queryKey: ["data-source-diagnostics", dataSource?.id],
    queryFn: () => api.dataSourceDiagnostics(dataSource!.id),
    enabled: Boolean(dataSource),
  });
  const save = useMutation({
    mutationFn: () => {
      const input = { provider, name, description, configuration };
      return dataSource
        ? api.updateDataSource(dataSource.id, input, csrf)
        : api.createDataSource(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onSaved(saved);
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewDataSource(
        provider,
        configuration,
        csrf,
        configuration.dateSelection.enabled ? previewDate : undefined,
      ) as Promise<StructuredPreview>,
    onSuccess: setPreview,
  });
  const mapping = configuration.mapping;
  const updateMapping = (
    key: keyof NonNullable<StructuredSourceConfig["mapping"]>,
    value: string | Record<string, string>,
  ) =>
    setConfiguration((current) => ({
      ...current,
      mapping: {
        ...(current.mapping ?? {
          rootList: "",
          title: "",
          subtitle: "",
          date: "",
          imageUrl: "",
          link: "",
        }),
        [key]: value,
      },
    }));
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="source-editor"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="structured-source-title"
      >
        <header>
          <div>
            <h2 id="structured-source-title">
              {dataSource ? "Edit" : "Create"} {provider.toUpperCase()} Data
              Source
            </h2>
            <p>Fetched data is sanitized and cached for offline playback.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-editor__body">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              value={name}
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              value={description}
              disabled={readOnly}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          {provider === "csv" && (
            <label className="field">
              <span className="field__label">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={readOnly}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void file.text().then((uploadedContent) =>
                      setConfiguration((c) => ({
                        ...c,
                        url: "",
                        uploadedContent,
                        uploaded: true,
                      })),
                    );
                }}
              />
            </label>
          )}
          {!(provider === "csv" && configuration.uploadedContent) && (
            <label className="field">
              <span className="field__label">Feed or data URL</span>
              <input
                type="url"
                value={configuration.url ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    url: e.target.value,
                    uploadedContent: undefined,
                    uploaded: false,
                  }))
                }
              />
            </label>
          )}
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Presentation</span>
              <select
                value={configuration.presentation}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    presentation: e.target
                      .value as StructuredSourceConfig["presentation"],
                  }))
                }
              >
                <option value="list">List</option>
                <option value="agenda">Agenda</option>
                <option value="cards">Cards</option>
                <option value="ticker">Ticker</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Maximum items</span>
              <input
                type="number"
                min="1"
                max="200"
                value={configuration.maxItems}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    maxItems: Number(e.target.value),
                  }))
                }
              />
            </label>
          </div>
          <fieldset>
            <legend>Displayed fields</legend>
            <div className="checkbox-grid">
              {(
                Object.keys(configuration.fields) as Array<
                  keyof StructuredSourceConfig["fields"]
                >
              ).map((field) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={configuration.fields[field]}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        fields: {
                          ...current.fields,
                          [field]: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>{field}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Keyword filter</span>
              <input
                value={configuration.filterKeyword ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    filterKeyword: e.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Sort</span>
              <select
                value={configuration.sort}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    sort: e.target.value as StructuredSourceConfig["sort"],
                  }))
                }
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title</option>
                <option value="source">Original order</option>
              </select>
            </label>
          </div>
          {(provider === "json" || provider === "csv") && mapping && (
            <fieldset>
              <legend>Field mapping</legend>
              {provider === "json" && (
                <label className="field">
                  <span className="field__label">Root list path</span>
                  <input
                    value={mapping.rootList}
                    disabled={readOnly}
                    onChange={(e) => updateMapping("rootList", e.target.value)}
                  />
                </label>
              )}
              <fieldset>
                <legend>Date-aware selection</legend>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={configuration.dateSelection.enabled}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        dateSelection: {
                          ...current.dateSelection,
                          enabled: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>
                    <strong>Select records by local date</strong>
                    <small>
                      The Player reevaluates cached records at the configured
                      local date transition.
                    </small>
                  </span>
                </label>
                {configuration.dateSelection.enabled && (
                  <>
                    <div className="form-grid form-grid--2">
                      <label className="field">
                        <span className="field__label">Date format</span>
                        <select
                          value={configuration.dateSelection.dateFormat}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfiguration((current) => ({
                              ...current,
                              dateSelection: {
                                ...current.dateSelection,
                                dateFormat: event.target
                                  .value as StructuredSourceConfig["dateSelection"]["dateFormat"],
                              },
                            }))
                          }
                        >
                          <option value="auto">Detect</option>
                          <option value="iso_date">YYYY-MM-DD</option>
                          <option value="us_date">MM/DD/YYYY</option>
                          <option value="us_short">M/D/YYYY</option>
                          <option value="day_month_name">DD-Mon-YYYY</option>
                          <option value="rfc3339">RFC 3339</option>
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">Timezone</span>
                        <input
                          value={configuration.dateSelection.timezone}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfiguration((current) => ({
                              ...current,
                              dateSelection: {
                                ...current.dateSelection,
                                timezone: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">Selection</span>
                        <select
                          value={configuration.dateSelection.mode}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfiguration((current) => ({
                              ...current,
                              dateSelection: {
                                ...current.dateSelection,
                                mode: event.target
                                  .value as StructuredSourceConfig["dateSelection"]["mode"],
                              },
                            }))
                          }
                        >
                          <option value="today">Today</option>
                          <option value="tomorrow">Tomorrow</option>
                          <option value="next_available">
                            Next available date
                          </option>
                          <option value="current_week">Current week</option>
                          <option value="custom_range">
                            Custom date range
                          </option>
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">No match</span>
                        <select
                          value={configuration.dateSelection.noMatchBehavior}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfiguration((current) => ({
                              ...current,
                              dateSelection: {
                                ...current.dateSelection,
                                noMatchBehavior: event.target
                                  .value as StructuredSourceConfig["dateSelection"]["noMatchBehavior"],
                              },
                            }))
                          }
                        >
                          <option value="empty">Display empty state</option>
                          <option value="fallback_text">
                            Show fallback text
                          </option>
                          <option value="next_available">
                            Show next available
                          </option>
                          <option value="hide">Hide Widget or binding</option>
                          <option value="last_known_good">
                            Use last-known-good record
                          </option>
                        </select>
                      </label>
                    </div>
                    {configuration.dateSelection.mode === "custom_range" && (
                      <div className="form-grid form-grid--2">
                        <label className="field">
                          <span className="field__label">Start date</span>
                          <input
                            type="date"
                            value={
                              configuration.dateSelection.customStartDate ?? ""
                            }
                            disabled={readOnly}
                            onChange={(event) =>
                              setConfiguration((current) => ({
                                ...current,
                                dateSelection: {
                                  ...current.dateSelection,
                                  customStartDate: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span className="field__label">End date</span>
                          <input
                            type="date"
                            value={
                              configuration.dateSelection.customEndDate ?? ""
                            }
                            disabled={readOnly}
                            onChange={(event) =>
                              setConfiguration((current) => ({
                                ...current,
                                dateSelection: {
                                  ...current.dateSelection,
                                  customEndDate: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                      </div>
                    )}
                    {configuration.dateSelection.noMatchBehavior ===
                      "fallback_text" && (
                      <label className="field">
                        <span className="field__label">Fallback text</span>
                        <input
                          value={configuration.dateSelection.fallbackText ?? ""}
                          disabled={readOnly}
                          onChange={(event) =>
                            setConfiguration((current) => ({
                              ...current,
                              dateSelection: {
                                ...current.dateSelection,
                                fallbackText: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    )}
                    <label className="switch-row">
                      <input
                        type="checkbox"
                        checked={configuration.dateSelection.excludePast}
                        disabled={readOnly}
                        onChange={(event) =>
                          setConfiguration((current) => ({
                            ...current,
                            dateSelection: {
                              ...current.dateSelection,
                              excludePast: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span>Exclude past records</span>
                    </label>
                    <label className="field">
                      <span className="field__label">Preview date</span>
                      <input
                        type="date"
                        value={previewDate}
                        onChange={(event) => setPreviewDate(event.target.value)}
                      />
                    </label>
                  </>
                )}
              </fieldset>
              <div className="form-grid form-grid--2">
                {(
                  ["title", "subtitle", "date", "imageUrl", "link"] as const
                ).map((key) => (
                  <label className="field" key={key}>
                    <span className="field__label">{key}</span>
                    <input
                      value={mapping[key]}
                      disabled={readOnly}
                      onChange={(e) => updateMapping(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              {provider === "csv" && (
                <label className="field">
                  <span className="field__label">Delimiter</span>
                  <select
                    value={configuration.delimiter ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      setConfiguration((c) => ({
                        ...c,
                        delimiter: e.target
                          .value as StructuredSourceConfig["delimiter"],
                      }))
                    }
                  >
                    <option value="">Detect</option>
                    <option value=",">Comma</option>
                    <option value=";">Semicolon</option>
                    <option value="\t">Tab</option>
                    <option value="|">Pipe</option>
                  </select>
                </label>
              )}
              <div className="source-mapping-list">
                <strong>Optional values</strong>
                {Object.entries(mapping.valueFields ?? {}).map(
                  ([label, path]) => (
                    <div className="source-mapping-row" key={label}>
                      <input
                        aria-label="Value label"
                        value={label}
                        disabled={readOnly}
                        onChange={(event) => {
                          const values = { ...(mapping.valueFields ?? {}) };
                          delete values[label];
                          values[event.target.value] = path;
                          updateMapping("valueFields", values);
                        }}
                      />
                      <input
                        aria-label="Value path or column"
                        value={path}
                        disabled={readOnly}
                        onChange={(event) =>
                          updateMapping("valueFields", {
                            ...(mapping.valueFields ?? {}),
                            [label]: event.target.value,
                          })
                        }
                      />
                      <button
                        className="icon-button"
                        aria-label={`Remove ${label}`}
                        disabled={readOnly}
                        onClick={() => {
                          const values = { ...(mapping.valueFields ?? {}) };
                          delete values[label];
                          updateMapping("valueFields", values);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ),
                )}
                {!readOnly &&
                  Object.keys(mapping.valueFields ?? {}).length < 12 && (
                    <button
                      type="button"
                      className="button button--quiet"
                      onClick={() =>
                        updateMapping("valueFields", {
                          ...(mapping.valueFields ?? {}),
                          [`Value ${Object.keys(mapping.valueFields ?? {}).length + 1}`]:
                            provider === "json" ? "/value" : "value",
                        })
                      }
                    >
                      <Plus size={15} /> Add value
                    </button>
                  )}
              </div>
            </fieldset>
          )}
          <fieldset>
            <legend>Record filters</legend>
            <div className="source-mapping-list">
              {(configuration.filters ?? []).map((filter, index) => (
                <div className="source-mapping-row" key={index}>
                  <input
                    aria-label="Filter field"
                    value={filter.field}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        filters: (current.filters ?? []).map(
                          (item, position) =>
                            position === index
                              ? { ...item, field: event.target.value }
                              : item,
                        ),
                      }))
                    }
                  />
                  <select
                    aria-label="Filter operator"
                    value={filter.operator}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        filters: (current.filters ?? []).map(
                          (item, position) =>
                            position === index
                              ? {
                                  ...item,
                                  operator: event.target.value as
                                    "equals" | "contains",
                                }
                              : item,
                        ),
                      }))
                    }
                  >
                    <option value="equals">Equals</option>
                    <option value="contains">Contains</option>
                  </select>
                  <input
                    aria-label="Filter value"
                    value={filter.value}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        filters: (current.filters ?? []).map(
                          (item, position) =>
                            position === index
                              ? { ...item, value: event.target.value }
                              : item,
                        ),
                      }))
                    }
                  />
                  <button
                    className="icon-button"
                    aria-label="Remove filter"
                    disabled={readOnly}
                    onClick={() =>
                      setConfiguration((current) => ({
                        ...current,
                        filters: (current.filters ?? []).filter(
                          (_, position) => position !== index,
                        ),
                      }))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {!readOnly && (configuration.filters?.length ?? 0) < 8 && (
                <button
                  type="button"
                  className="button button--quiet"
                  onClick={() =>
                    setConfiguration((current) => ({
                      ...current,
                      filters: [
                        ...(current.filters ?? []),
                        { field: "title", operator: "contains", value: "" },
                      ],
                    }))
                  }
                >
                  <Plus size={15} /> Add filter
                </button>
              )}
            </div>
          </fieldset>
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Refresh interval</span>
              <select
                value={configuration.refreshIntervalSeconds}
                disabled={readOnly || Boolean(configuration.uploaded)}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    refreshIntervalSeconds: Number(e.target.value),
                  }))
                }
              >
                <option value="300">5 minutes</option>
                <option value="900">15 minutes</option>
                <option value="3600">Hourly</option>
                <option value="21600">6 hours</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Empty state</span>
              <input
                value={configuration.emptyState}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((c) => ({
                    ...c,
                    emptyState: e.target.value,
                  }))
                }
              />
            </label>
          </div>
          {diagnostics.data && (
            <div className="source-diagnostics">
              <strong>Refresh diagnostics</strong>
              <span>
                {diagnostics.data.parseStatus} ·{" "}
                {diagnostics.data.httpResultCategory ?? "not attempted"} ·{" "}
                {diagnostics.data.availableItemCount} items
                {diagnostics.data.usingCachedData ? " · cached data" : ""}
              </span>
              <small>
                Last attempt:{" "}
                {diagnostics.data.lastAttemptedRefresh
                  ? new Date(
                      diagnostics.data.lastAttemptedRefresh,
                    ).toLocaleString()
                  : "Not yet"}
              </small>
              <small>
                Last success:{" "}
                {diagnostics.data.lastSuccessfulRefresh
                  ? new Date(
                      diagnostics.data.lastSuccessfulRefresh,
                    ).toLocaleString()
                  : "Not yet"}
              </small>
            </div>
          )}
          {preview && (
            <div className="calendar-preview">
              <strong>
                {preview.configuration.data.records.length} mapped items
              </strong>
              {preview.configuration.data.records.slice(0, 8).map((record) => (
                <article key={record.id}>
                  <strong>{record.title || "Untitled item"}</strong>
                  {record.subtitle && <span>{record.subtitle}</span>}
                  {record.date && <small>{record.date}</small>}
                </article>
              ))}
            </div>
          )}
          {(previewMutation.error || save.error) && (
            <p className="form-error">
              {(previewMutation.error ?? save.error)?.message}
            </p>
          )}
        </div>
        <footer>
          <button
            className="button button--quiet"
            disabled={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending
              ? "Loading preview…"
              : "Preview mapped data"}
          </button>
          {!readOnly && (
            <button
              className="button button--primary"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save Data Source"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

const defaultCalendar: CalendarConfig = {
  calendars: [{ name: "Calendar", url: "https://" }],
  displayMode: "upcoming",
  maxEvents: 10,
  fields: {
    title: true,
    startTime: true,
    endTime: false,
    date: true,
    location: true,
    descriptionExcerpt: false,
  },
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  refreshIntervalSeconds: 900,
  stalenessLimitHours: 168,
  emptyState: "No events scheduled",
};

export function CalendarDataSourceEditor({
  dataSource,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
  page = false,
}: {
  dataSource?: DataSourceDetail;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (dataSource: DataSourceDetail) => void;
  page?: boolean;
}) {
  const queryClient = useQueryClient();
  const configured = dataSource?.configuration as CalendarConfig | undefined;
  const [name, setName] = useState(dataSource?.name ?? "");
  const [description, setDescription] = useState(dataSource?.description ?? "");
  const [configuration, setConfiguration] = useState<CalendarConfig>(
    configured ?? defaultCalendar,
  );
  const [preview, setPreview] = useState<CalendarPreview>();
  const diagnostics = useQuery({
    queryKey: ["data-source-diagnostics", dataSource?.id],
    queryFn: () => api.dataSourceDiagnostics(dataSource!.id),
    enabled: Boolean(dataSource),
  });
  const save = useMutation({
    mutationFn: () => {
      const input = {
        provider: "calendar" as const,
        name,
        description,
        configuration,
      };
      return dataSource
        ? api.updateDataSource(dataSource.id, input, csrf)
        : api.createDataSource(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onSaved(saved);
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewDataSource(
        "calendar",
        configuration,
        csrf,
      ) as Promise<CalendarPreview>,
    onSuccess: setPreview,
  });
  const updateFeed = (index: number, key: "name" | "url", value: string) =>
    setConfiguration((current) => {
      const previousName = current.calendars[index]?.name;
      return {
        ...current,
        calendars: current.calendars.map((feed, position) =>
          position === index ? { ...feed, [key]: value } : feed,
        ),
        filterCalendars:
          key === "name"
            ? current.filterCalendars?.map((name) =>
                name === previousName ? value : name,
              )
            : current.filterCalendars,
      };
    });
  const diagnostic = diagnostics.data;
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="asset-details source-editor"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="calendar-source-title"
      >
        <header>
          <div>
            <h2 id="calendar-source-title">
              {dataSource
                ? "Edit Calendar Data Source"
                : "Create Calendar Data Source"}
            </h2>
            <p>
              Tilecast fetches and sanitizes public iCalendar feeds for native
              playback.
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-editor__columns">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              disabled={readOnly}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Description</span>
            <input
              disabled={readOnly}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <fieldset className="source-editor__fieldset">
          <legend>Calendars</legend>
          {configuration.calendars.map((feed, index) => (
            <div className="source-editor__columns" key={index}>
              <label className="field">
                <span className="field__label">Calendar name</span>
                <input
                  disabled={readOnly}
                  value={feed.name}
                  onChange={(event) =>
                    updateFeed(index, "name", event.target.value)
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Public ICS URL</span>
                <input
                  disabled={readOnly}
                  type="url"
                  value={feed.url}
                  onChange={(event) =>
                    updateFeed(index, "url", event.target.value)
                  }
                />
              </label>
              {!readOnly && configuration.calendars.length > 1 && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Remove ${feed.name}`}
                  onClick={() =>
                    setConfiguration((current) => ({
                      ...current,
                      calendars: current.calendars.filter(
                        (_, position) => position !== index,
                      ),
                    }))
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          {!readOnly && configuration.calendars.length < 8 && (
            <button
              className="button button--quiet"
              type="button"
              onClick={() =>
                setConfiguration((current) => ({
                  ...current,
                  calendars: [
                    ...current.calendars,
                    {
                      name: `Calendar ${current.calendars.length + 1}`,
                      url: "https://",
                    },
                  ],
                }))
              }
            >
              <Plus size={16} /> Add calendar
            </button>
          )}
        </fieldset>
        <div className="source-editor__columns">
          <label className="field">
            <span className="field__label">Display</span>
            <select
              disabled={readOnly}
              value={configuration.displayMode}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  displayMode: event.target
                    .value as CalendarConfig["displayMode"],
                })
              }
            >
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="this_week">This week</option>
              <option value="agenda">Agenda</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Maximum events</span>
            <input
              disabled={readOnly}
              type="number"
              min={1}
              max={100}
              value={configuration.maxEvents}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  maxEvents: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Timezone</span>
            <input
              disabled={readOnly}
              value={configuration.timezone}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  timezone: event.target.value,
                })
              }
            />
          </label>
        </div>
        <fieldset className="source-editor__fieldset">
          <legend>Event details</legend>
          {(
            Object.keys(
              configuration.fields,
            ) as (keyof CalendarConfig["fields"])[]
          ).map((field) => (
            <label key={field} className="checkbox-row">
              <input
                disabled={readOnly}
                type="checkbox"
                checked={configuration.fields[field]}
                onChange={(event) =>
                  setConfiguration({
                    ...configuration,
                    fields: {
                      ...configuration.fields,
                      [field]: event.target.checked,
                    },
                  })
                }
              />
              <span>
                {
                  {
                    title: "Title",
                    startTime: "Start time",
                    endTime: "End time",
                    date: "Date",
                    location: "Location",
                    descriptionExcerpt: "Description excerpt",
                  }[field]
                }
              </span>
            </label>
          ))}
        </fieldset>
        {configuration.calendars.length > 1 && (
          <fieldset className="source-editor__fieldset">
            <legend>Calendar filter</legend>
            <small>No selection includes every configured calendar.</small>
            {configuration.calendars.map((feed) => {
              const selected =
                configuration.filterCalendars?.includes(feed.name) ?? false;
              return (
                <label key={feed.name} className="checkbox-row">
                  <input
                    disabled={readOnly}
                    type="checkbox"
                    checked={selected}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        filterCalendars: event.target.checked
                          ? [...(current.filterCalendars ?? []), feed.name]
                          : (current.filterCalendars ?? []).filter(
                              (name) => name !== feed.name,
                            ),
                      }))
                    }
                  />
                  <span>{feed.name}</span>
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="source-editor__columns">
          <label className="field">
            <span className="field__label">Keyword filter</span>
            <input
              disabled={readOnly}
              value={configuration.filterKeyword ?? ""}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  filterKeyword: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Refresh interval</span>
            <select
              disabled={readOnly}
              value={configuration.refreshIntervalSeconds}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  refreshIntervalSeconds: Number(event.target.value),
                })
              }
            >
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
              <option value={3600}>1 hour</option>
              <option value={21600}>6 hours</option>
              <option value={86400}>1 day</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Empty state</span>
            <input
              disabled={readOnly}
              value={configuration.emptyState}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  emptyState: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Keep cached data</span>
            <select
              disabled={readOnly}
              value={configuration.stalenessLimitHours}
              onChange={(event) =>
                setConfiguration({
                  ...configuration,
                  stalenessLimitHours: Number(event.target.value),
                })
              }
            >
              <option value={24}>1 day</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
              <option value={720}>30 days</option>
            </select>
          </label>
        </div>
        {diagnostic && (
          <div className="source-diagnostics">
            <strong>Refresh diagnostics</strong>
            <span>
              {diagnostic.parseStatus} ·{" "}
              {diagnostic.httpResultCategory ?? "not attempted"} ·{" "}
              {diagnostic.availableEventCount} events
              {diagnostic.usingCachedData ? " · cached data" : ""}
            </span>
            <small>
              Last attempt:{" "}
              {diagnostic.lastAttemptedRefresh
                ? new Date(diagnostic.lastAttemptedRefresh).toLocaleString()
                : "Not yet"}
            </small>
            <small>
              Last success:{" "}
              {diagnostic.lastSuccessfulRefresh
                ? new Date(diagnostic.lastSuccessfulRefresh).toLocaleString()
                : "Not yet"}
            </small>
          </div>
        )}
        {preview && (
          <div className="source-preview-list">
            {preview.configuration.data.events
              .slice(0, configuration.maxEvents)
              .map((event) => (
                <article key={event.id}>
                  <strong>{event.title || "Untitled event"}</strong>
                  <span>
                    {event.allDay
                      ? new Date(event.start).toLocaleDateString()
                      : new Date(event.start).toLocaleString()}
                  </span>
                  {event.location && <small>{event.location}</small>}
                </article>
              ))}
            {!preview.configuration.data.events.length && (
              <p>{configuration.emptyState}</p>
            )}
          </div>
        )}
        {(previewMutation.error || save.error) && (
          <p className="form-error">
            {(previewMutation.error ?? save.error)?.message}
          </p>
        )}
        <footer>
          <button
            className="button button--quiet"
            type="button"
            disabled={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending
              ? "Loading preview…"
              : "Preview real data"}
          </button>
          {!readOnly && (
            <button
              className="button button--primary"
              type="button"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save Data Source"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

export function DataSourceEditor({
  provider,
  dataSource,
  csrf,
  readOnly,
  onClose,
  onSaved,
  page,
}: {
  provider: DataSourceProvider;
  dataSource?: DataSourceDetail;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (dataSource: DataSourceDetail) => void;
  page?: boolean;
}) {
  if (provider === "calendar")
    return (
      <CalendarDataSourceEditor
        dataSource={dataSource}
        csrf={csrf}
        readOnly={readOnly}
        onClose={onClose}
        onSaved={onSaved}
        page={page}
      />
    );
  return (
    <StructuredDataSourceEditor
      provider={provider}
      dataSource={dataSource}
      csrf={csrf}
      readOnly={readOnly}
      onClose={onClose}
      onSaved={onSaved}
      page={page}
    />
  );
}
