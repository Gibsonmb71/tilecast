import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Braces,
  CalendarDays,
  FileSpreadsheet,
  Globe2,
  Plus,
  Rss,
  Trash2,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  Asset,
  CalendarConfig,
  CalendarPreview,
  SourceProvider,
  StructuredPreview,
  StructuredSourceConfig,
  YouTubeConfig,
} from "../api/types";

export function SourceProviderGallery({
  onChoose,
  onClose,
}: {
  onChoose: (provider: SourceProvider) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [onClose]);
  return (
    <div className="details-backdrop" role="presentation">
      <section
        className="source-gallery"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-gallery-title"
      >
        <header>
          <div>
            <h2 id="source-gallery-title">Create source</h2>
            <p>Choose a built-in Source provider.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          <button type="button" onClick={() => onChoose("website")}>
            <Globe2 size={30} />
            <strong>Website</strong>
            <span>
              Display a website, dashboard, calendar, menu, or other webpage.
            </span>
          </button>
          <button type="button" onClick={() => onChoose("youtube")}>
            <Youtube size={30} />
            <strong>YouTube</strong>
            <span>Play a YouTube video or playlist without an API key.</span>
          </button>
          <button type="button" onClick={() => onChoose("calendar")}>
            <CalendarDays size={30} />
            <strong>Calendar</strong>
            <span>
              Show today, upcoming, weekly, or agenda events from ICS feeds.
            </span>
          </button>
          <button type="button" onClick={() => onChoose("rss")}>
            <Rss size={30} />
            <strong>RSS</strong>
            <span>Show recent posts and announcements from an RSS feed.</span>
          </button>
          <button type="button" onClick={() => onChoose("atom")}>
            <Rss size={30} />
            <strong>Atom</strong>
            <span>Show entries from a standards-based Atom feed.</span>
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

const defaultStructured = (
  provider: "rss" | "atom" | "json" | "csv",
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
});

export function StructuredSourceEditor({
  provider,
  asset,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
}: {
  provider: "rss" | "atom" | "json" | "csv";
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [configuration, setConfiguration] = useState<StructuredSourceConfig>(
    (asset?.source?.configuration as StructuredSourceConfig | undefined) ??
      defaultStructured(provider),
  );
  const [preview, setPreview] = useState<StructuredPreview>();
  const diagnostics = useQuery({
    queryKey: ["source-diagnostics", asset?.id],
    queryFn: () => api.sourceDiagnostics(asset!.id),
    enabled: Boolean(asset),
  });
  const save = useMutation({
    mutationFn: () => {
      const input = { provider, name, description, configuration };
      return asset
        ? api.updateSource(asset.id, input, csrf)
        : api.createSource(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      api.previewStructuredSource(provider, configuration, csrf),
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
    <div className="details-backdrop" role="presentation">
      <section
        className="source-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="structured-source-title"
      >
        <header>
          <div>
            <h2 id="structured-source-title">
              {asset ? "Edit" : "Create"} {provider.toUpperCase()} source
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
                <option value="source">Source order</option>
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
              {save.isPending ? "Saving…" : "Save source"}
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

export function CalendarSourceEditor({
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
  const queryClient = useQueryClient();
  const configured = asset?.source?.configuration as CalendarConfig | undefined;
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [configuration, setConfiguration] = useState<CalendarConfig>(
    configured ?? defaultCalendar,
  );
  const [preview, setPreview] = useState<CalendarPreview>();
  const diagnostics = useQuery({
    queryKey: ["source-diagnostics", asset?.id],
    queryFn: () => api.sourceDiagnostics(asset!.id),
    enabled: Boolean(asset),
  });
  const save = useMutation({
    mutationFn: () => {
      const input = {
        provider: "calendar" as const,
        name,
        description,
        configuration,
      };
      return asset
        ? api.updateSource(asset.id, input, csrf)
        : api.createSource(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  const previewMutation = useMutation({
    mutationFn: () => api.previewCalendarSource(configuration, csrf),
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
    <div className="details-backdrop" role="presentation">
      <section
        className="asset-details source-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-source-title"
      >
        <header>
          <div>
            <h2 id="calendar-source-title">
              {asset ? "Edit Calendar source" : "Create Calendar source"}
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
              {save.isPending ? "Saving…" : "Save calendar source"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

const defaultYouTube: YouTubeConfig = {
  url: "https://www.youtube.com/watch?v=",
  startSeconds: 0,
  loop: false,
  muted: false,
  volume: 100,
  captions: false,
  captionLanguage: "",
  controls: false,
  failureBehavior: "placeholder",
  playlistPlaybackMode: "until_end",
};

export function YouTubeSourceEditor({
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
  const queryClient = useQueryClient();
  const configured = asset?.source?.configuration as YouTubeConfig | undefined;
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [configuration, setConfiguration] = useState<YouTubeConfig>(
    configured ?? defaultYouTube,
  );
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof YouTubeConfig>(
    key: K,
    value: YouTubeConfig[K],
  ) => {
    setConfiguration((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [dirty]);
  const images = useQuery({
    queryKey: ["assets", "source-fallbacks"],
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
  const save = useMutation({
    mutationFn: () => {
      const input = {
        provider: "youtube" as const,
        name,
        description,
        configuration,
      };
      return asset
        ? api.updateSource(asset.id, input, csrf)
        : api.createSource(input, csrf);
    },
    onSuccess: (saved) => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  const close = () => {
    if (!dirty || confirm("Discard unsaved YouTube source changes?")) onClose();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!dirty || confirm("Discard unsaved YouTube source changes?"))
          onClose();
      }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [dirty, onClose]);
  return (
    <div className="details-backdrop" role="presentation">
      <section
        className="asset-details source-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="youtube-source-title"
      >
        <header>
          <div>
            <h2 id="youtube-source-title">
              {asset ? "Edit YouTube source" : "Create YouTube source"}
            </h2>
            <p>
              Videos and playlists play fullscreen through YouTube’s embedded
              player.
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
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            disabled={readOnly}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">YouTube video or playlist URL</span>
          <input
            disabled={readOnly}
            value={configuration.url}
            onChange={(event) => set("url", event.target.value)}
          />
          <small>
            Tilecast detects whether this is a video or playlist. No YouTube API
            key is required.
          </small>
        </label>
        <div className="source-editor__columns">
          <label className="field">
            <span className="field__label">Start time (seconds)</span>
            <input
              type="number"
              min={0}
              disabled={readOnly}
              value={configuration.startSeconds}
              onChange={(event) =>
                set("startSeconds", Number(event.target.value))
              }
            />
          </label>
          <label className="field">
            <span className="field__label">End time (optional)</span>
            <input
              type="number"
              min={1}
              disabled={readOnly}
              value={configuration.endSeconds ?? ""}
              onChange={(event) =>
                set(
                  "endSeconds",
                  event.target.value ? Number(event.target.value) : undefined,
                )
              }
            />
          </label>
          <label className="field">
            <span className="field__label">Volume</span>
            <div className="unit-input">
              <input
                type="number"
                min={0}
                max={100}
                disabled={readOnly || configuration.muted}
                value={configuration.volume}
                onChange={(event) => set("volume", Number(event.target.value))}
              />
              <span>%</span>
            </div>
          </label>
          <label className="field">
            <span className="field__label">Caption language</span>
            <input
              disabled={readOnly || !configuration.captions}
              placeholder="en"
              value={configuration.captionLanguage}
              onChange={(event) => set("captionLanguage", event.target.value)}
            />
          </label>
        </div>
        <div className="source-switches">
          {(
            [
              ["loop", "Loop playback"],
              ["muted", "Mute audio"],
              ["captions", "Show captions"],
              ["controls", "Show YouTube controls"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                disabled={readOnly}
                checked={configuration[key]}
                onChange={(event) => set(key, event.target.checked)}
              />{" "}
              {label}
            </label>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Playlist item behavior</span>
          <select
            disabled={readOnly}
            value={configuration.playlistPlaybackMode}
            onChange={(event) =>
              set(
                "playlistPlaybackMode",
                event.target.value as YouTubeConfig["playlistPlaybackMode"],
              )
            }
          >
            <option value="until_end">Play until video ends</option>
            <option value="fixed_duration">Play for a fixed duration</option>
          </select>
        </label>
        {configuration.playlistPlaybackMode === "fixed_duration" && (
          <label className="field">
            <span className="field__label">Fixed duration (seconds)</span>
            <input
              type="number"
              min={1}
              max={86400}
              disabled={readOnly}
              value={configuration.fixedDurationSeconds ?? 30}
              onChange={(event) =>
                set("fixedDurationSeconds", Number(event.target.value))
              }
            />
          </label>
        )}
        <label className="field">
          <span className="field__label">Failure behavior</span>
          <select
            disabled={readOnly}
            value={configuration.failureBehavior}
            onChange={(event) =>
              set(
                "failureBehavior",
                event.target.value as YouTubeConfig["failureBehavior"],
              )
            }
          >
            <option value="placeholder">Show Tilecast placeholder</option>
            <option value="fallback_image">Show fallback image</option>
            <option value="skip">Skip playlist item</option>
          </select>
        </label>
        <label className="field">
          <span className="field__label">Fallback image</span>
          <select
            disabled={readOnly}
            value={configuration.fallbackImageAssetId ?? ""}
            onChange={(event) =>
              set("fallbackImageAssetId", event.target.value || undefined)
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
        {save.error && (
          <div className="notice notice--error">{save.error.message}</div>
        )}
        <footer>
          {!readOnly && (
            <button
              className="button button--primary"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save source"}
            </button>
          )}
          <button className="button button--quiet" onClick={close}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
