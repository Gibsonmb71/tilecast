import { Select } from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CloudSun,
  Clock3,
  Gauge,
  LayoutGrid,
  QrCode,
  TextQuote,
  Globe2,
  ListTree,
  Table2,
  Utensils,
  Timer,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  Asset,
  DataSource,
  DataSourceField,
  WidgetProvider,
  ClockWidgetConfig,
  DateWidgetConfig,
  QRCodeWidgetConfig,
  CountdownWidgetConfig,
  TickerWidgetConfig,
  DisplayWidgetConfig,
  FieldFormat,
  MetricWidgetConfig,
  CardsWidgetConfig,
  WeatherWidgetConfig,
  YouTubeConfig,
  WidgetPresentation,
  PresentationNode,
} from "../api/types";

export function WidgetProviderGallery({
  onChoose,
  onClose,
  page = false,
}: {
  onChoose: (provider: WidgetProvider) => void;
  onClose: () => void;
  page?: boolean;
}) {
  const catalog = useQuery({
    queryKey: ["provider-catalog"],
    queryFn: api.providerCatalog,
    staleTime: 5 * 60_000,
  });
  const widgetProviders =
    catalog.data?.providers.filter((entry) => entry.role === "widget") ?? [];
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
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="source-gallery"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="source-gallery-title"
      >
        <header>
          <div>
            <h2 id="source-gallery-title">Create Widget</h2>
            <p>
              Choose a Tilecast provider compiled to the declarative runtime.
              {widgetProviders.length > 0
                ? ` ${widgetProviders.filter((entry) => entry.presentationKind === "native").length} native and ${widgetProviders.filter((entry) => entry.presentationKind === "web").length} sandboxed web providers are available.`
                : ""}
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-groups">
          <section className="source-provider-group">
            <h3>Web and video</h3>
            <div className="source-provider-grid">
              <button type="button" onClick={() => onChoose("website")}>
                <Globe2 size={26} />
                <strong>Website</strong>
                <span>Display an approved webpage.</span>
              </button>
              <button type="button" onClick={() => onChoose("youtube")}>
                <Youtube size={26} />
                <strong>YouTube</strong>
                <span>
                  Play a YouTube video or playlist without an API key.
                </span>
              </button>
            </div>
          </section>
          <section className="source-provider-group">
            <h3>Essentials</h3>
            <div className="source-provider-grid">
              <button type="button" onClick={() => onChoose("clock")}>
                <Clock3 size={26} />
                <strong>Clock</strong>
                <span>Show live local time in a configured timezone.</span>
              </button>
              <button type="button" onClick={() => onChoose("date")}>
                <CalendarDays size={26} />
                <strong>Date</strong>
                <span>Show a live localized calendar date.</span>
              </button>
              <button type="button" onClick={() => onChoose("qrcode")}>
                <QrCode size={26} />
                <strong>QR Code</strong>
                <span>Display text or a URL as a scannable code.</span>
              </button>
              <button type="button" onClick={() => onChoose("countdown")}>
                <Timer size={26} />
                <strong>Countdown</strong>
                <span>
                  Count down to or up from a configured date and time.
                </span>
              </button>
            </div>
          </section>
          <section className="source-provider-group">
            <h3>Data-driven</h3>
            <div className="source-provider-grid">
              <button type="button" onClick={() => onChoose("ticker")}>
                <TextQuote size={26} />
                <strong>Ticker</strong>
                <span>Scroll a selected field from a Data Source.</span>
              </button>
              <button type="button" onClick={() => onChoose("menu")}>
                <Utensils size={26} />
                <strong>Menu</strong>
                <span>Format selected fields as a signage menu.</span>
              </button>
              <button type="button" onClick={() => onChoose("list")}>
                <ListTree size={26} />
                <strong>List</strong>
                <span>Present records from a reusable Data Source.</span>
              </button>
              <button type="button" onClick={() => onChoose("table")}>
                <Table2 size={26} />
                <strong>Table</strong>
                <span>Show selected fields in structured columns.</span>
              </button>
              <button type="button" onClick={() => onChoose("agenda")}>
                <CalendarDays size={26} />
                <strong>Agenda</strong>
                <span>Display dated records in agenda form.</span>
              </button>
              <button type="button" onClick={() => onChoose("metric")}>
                <Gauge size={26} />
                <strong>Metric</strong>
                <span>Highlight a numeric value from a Data Source.</span>
              </button>
              <button type="button" onClick={() => onChoose("cards")}>
                <LayoutGrid size={26} />
                <strong>Cards</strong>
                <span>Arrange reusable records in a responsive card grid.</span>
              </button>
              <button type="button" onClick={() => onChoose("weather")}>
                <CloudSun size={26} />
                <strong>Weather</strong>
                <span>Show current conditions and a daily forecast.</span>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

type NativeProvider =
  | "clock"
  | "date"
  | "qrcode"
  | "countdown"
  | "ticker"
  | "menu"
  | "list"
  | "table"
  | "agenda"
  | "metric"
  | "cards"
  | "weather";
type NativeConfig =
  | ClockWidgetConfig
  | DateWidgetConfig
  | QRCodeWidgetConfig
  | CountdownWidgetConfig
  | TickerWidgetConfig
  | DisplayWidgetConfig
  | MetricWidgetConfig
  | CardsWidgetConfig
  | WeatherWidgetConfig;
const nativeDefault = (provider: NativeProvider): NativeConfig => {
  const colors = { foregroundColor: "#F5F7FA", backgroundColor: "#0E141B" };
  if (provider === "clock")
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      format: "12",
      showSeconds: false,
      ...colors,
    };
  if (provider === "date")
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      format: "full",
      ...colors,
    };
  if (provider === "qrcode")
    return {
      value: "https://",
      label: "",
      errorCorrection: "medium",
      foregroundColor: "#000000",
      backgroundColor: "#FFFFFF",
    };
  if (provider === "countdown")
    return {
      target: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      mode: "countdown",
      label: "",
      completionText: "Event started",
      completionAction: "completed_text",
      showDays: true,
      showHours: true,
      showMinutes: true,
      showSeconds: false,
      ...colors,
    };
  if (provider === "metric")
    return {
      dataSourceId: "",
      valueField: "",
      label: "",
      format: "number",
      precision: 0,
      alignment: "center",
      emptyState: "No value available",
      ...colors,
    };
  if (provider === "cards")
    return {
      dataSourceId: "",
      titleField: "",
      columns: 2,
      maximumItems: 6,
      density: "comfortable",
      emptyState: "No items available",
      ...colors,
    };
  if (provider === "weather")
    return {
      dataSourceId: "",
      showLocation: true,
      showCurrent: true,
      showHumidity: true,
      showWind: true,
      showPrecipitation: true,
      forecastDays: 5,
      ...colors,
    };
  if (["menu", "list", "table", "agenda"].includes(provider))
    return {
      dataSourceId: "",
      fields: ["title", "subtitle"],
      maximumItems: provider === "menu" ? 2 : 20,
      emptyState: "No items available",
      rowSpacing: "comfortable",
      mode: provider === "menu" ? "single_record" : "records",
      ...colors,
    };
  return {
    dataSourceId: "",
    field: "title",
    separator: " • ",
    speed: "normal",
    direction: "left",
    emptyState: "No items available",
    ...colors,
  };
};

export function NativeAppEditor({
  provider,
  asset,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
  page = false,
}: {
  provider: NativeProvider;
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  page?: boolean;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ["provider-catalog"],
    queryFn: api.providerCatalog,
    staleTime: 5 * 60_000,
  });
  const providerRuntime = catalog.data?.providers.find(
    (entry) => entry.role === "widget" && entry.id === provider,
  );
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [configuration, setConfiguration] = useState<NativeConfig>(
    (asset?.widget?.configuration as NativeConfig | undefined) ??
      nativeDefault(provider),
  );
  const dataSources = useQuery({
    queryKey: ["widget-data-sources"],
    queryFn: () =>
      api.listDataSources(
        new URLSearchParams({ page: "1", pageSize: "100", sort: "name" }),
      ),
    enabled: [
      "ticker",
      "menu",
      "list",
      "table",
      "agenda",
      "metric",
      "cards",
      "weather",
    ].includes(provider),
  });
  const acceptedProviders: Record<string, string[]> = {
    ticker: ["rss", "atom", "calendar", "json", "csv", "manual", "weather"],
    menu: ["calendar", "rss", "atom", "json", "csv", "manual", "weather"],
    list: ["calendar", "rss", "atom", "json", "csv", "manual", "weather"],
    table: ["calendar", "rss", "atom", "json", "csv", "manual", "weather"],
    agenda: ["calendar", "json", "csv", "manual", "weather"],
    metric: ["json", "csv", "manual", "weather"],
    cards: ["calendar", "rss", "atom", "json", "csv", "manual", "weather"],
    weather: ["weather"],
  };
  const compatibleDataSources = (dataSources.data?.items ?? []).filter(
    (source) => (acceptedProviders[provider] ?? []).includes(source.provider),
  );
  const selectedDataSourceId = [
    "ticker",
    "menu",
    "list",
    "table",
    "agenda",
    "metric",
    "cards",
    "weather",
  ].includes(provider)
    ? (
        configuration as
          | TickerWidgetConfig
          | DisplayWidgetConfig
          | MetricWidgetConfig
          | CardsWidgetConfig
          | WeatherWidgetConfig
      ).dataSourceId
    : "";
  const selectedDataSource = useQuery({
    queryKey: ["widget-data-source", selectedDataSourceId],
    queryFn: () => api.getDataSource(selectedDataSourceId),
    enabled: Boolean(selectedDataSourceId),
  });
  const sourcePreview = useQuery({
    queryKey: ["widget-data-source-preview", selectedDataSourceId],
    queryFn: () => api.previewSavedDataSource(selectedDataSourceId),
    enabled: Boolean(selectedDataSourceId),
  });
  const compiledPreview = useQuery({
    queryKey: ["compiled-widget-preview", provider, configuration],
    queryFn: () =>
      api.compileWidgetPreview(
        provider,
        configuration as Parameters<typeof api.compileWidgetPreview>[1],
        csrf,
      ),
    retry: false,
  });
  const availableFields = selectedDataSource.data?.fields ?? [];
  const save = useMutation({
    mutationFn: () => {
      const input = { provider, name, description, configuration };
      return asset
        ? api.updateWidget(asset.id, input, csrf)
        : api.createWidget(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  const updateColors = (
    key: "foregroundColor" | "backgroundColor",
    value: string,
  ) => setConfiguration((current) => ({ ...current, [key]: value }));
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="asset-details source-editor"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="native-app-title"
      >
        <header>
          <div>
            <h2 id="native-app-title">
              {asset ? "Edit" : "Create"}{" "}
              {provider === "qrcode"
                ? "QR Code"
                : provider[0]!.toUpperCase() + provider.slice(1)}{" "}
              Widget
            </h2>
            <p>
              Reusable Widget configuration. Runtime:{" "}
              <strong>{providerRuntime?.presentationKind ?? "native"}</strong>.
              The Player interprets its compiled presentation document.
            </p>
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
          {(provider === "clock" || provider === "date") && (
            <label className="field">
              <span className="field__label">Timezone</span>
              <input
                value={
                  (configuration as ClockWidgetConfig | DateWidgetConfig)
                    .timezone
                }
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((current) => ({
                    ...current,
                    timezone: e.target.value,
                  }))
                }
              />
            </label>
          )}
          {provider === "clock" && (
            <div className="form-grid form-grid--2">
              <label className="field">
                <span className="field__label">Time format</span>
                <Select
                  value={(configuration as ClockWidgetConfig).format}
                  disabled={readOnly}
                  onChange={(e) =>
                    setConfiguration((current) => ({
                      ...(current as ClockWidgetConfig),
                      format: e.target.value as "12" | "24",
                    }))
                  }
                >
                  <option value="12">12-hour</option>
                  <option value="24">24-hour</option>
                </Select>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={(configuration as ClockWidgetConfig).showSeconds}
                  disabled={readOnly}
                  onChange={(e) =>
                    setConfiguration((current) => ({
                      ...current,
                      showSeconds: e.target.checked,
                    }))
                  }
                />
                <span>Show seconds</span>
              </label>
            </div>
          )}
          {provider === "date" && (
            <label className="field">
              <span className="field__label">Date format</span>
              <Select
                value={(configuration as DateWidgetConfig).format}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((current) => ({
                    ...(current as DateWidgetConfig),
                    format: e.target.value as DateWidgetConfig["format"],
                  }))
                }
              >
                <option value="full">Full</option>
                <option value="long">Long</option>
                <option value="medium">Medium</option>
                <option value="short">Short</option>
              </Select>
            </label>
          )}
          {provider === "countdown" && (
            <>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Target date and time</span>
                  <input
                    type="datetime-local"
                    value={(configuration as CountdownWidgetConfig).target}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        target: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Timezone</span>
                  <input
                    value={(configuration as CountdownWidgetConfig).timezone}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        timezone: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Mode</span>
                  <Select
                    value={(configuration as CountdownWidgetConfig).mode}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...(current as CountdownWidgetConfig),
                        mode: event.target
                          .value as CountdownWidgetConfig["mode"],
                      }))
                    }
                  >
                    <option value="countdown">Count down</option>
                    <option value="count_up">Count up</option>
                  </Select>
                </label>
                <label className="field">
                  <span className="field__label">Completion behavior</span>
                  <Select
                    value={
                      (configuration as CountdownWidgetConfig).completionAction
                    }
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        completionAction: event.target
                          .value as CountdownWidgetConfig["completionAction"],
                      }))
                    }
                  >
                    <option value="completed_text">Show completion text</option>
                    <option value="hide">Hide</option>
                    <option value="count_up">Continue counting up</option>
                  </Select>
                </label>
              </div>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Label</span>
                  <input
                    value={(configuration as CountdownWidgetConfig).label ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Completion text</span>
                  <input
                    value={
                      (configuration as CountdownWidgetConfig).completionText ??
                      ""
                    }
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        completionText: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <fieldset>
                <legend>Visible units</legend>
                <div className="checkbox-grid">
                  {(["Days", "Hours", "Minutes", "Seconds"] as const).map(
                    (unit) => {
                      const key = `show${unit}` as keyof CountdownWidgetConfig;
                      return (
                        <label key={unit}>
                          <input
                            type="checkbox"
                            checked={Boolean(
                              (configuration as CountdownWidgetConfig)[key],
                            )}
                            disabled={readOnly}
                            onChange={(event) =>
                              setConfiguration((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          <span>{unit}</span>
                        </label>
                      );
                    },
                  )}
                </div>
              </fieldset>
            </>
          )}
          {provider === "qrcode" && (
            <>
              <label className="field">
                <span className="field__label">Text or URL</span>
                <textarea
                  value={(configuration as QRCodeWidgetConfig).value}
                  maxLength={2048}
                  disabled={readOnly}
                  onChange={(e) =>
                    setConfiguration((current) => ({
                      ...current,
                      value: e.target.value,
                    }))
                  }
                />
              </label>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Label</span>
                  <input
                    value={(configuration as QRCodeWidgetConfig).label ?? ""}
                    disabled={readOnly}
                    onChange={(e) =>
                      setConfiguration((current) => ({
                        ...current,
                        label: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Error correction</span>
                  <Select
                    value={
                      (configuration as QRCodeWidgetConfig).errorCorrection
                    }
                    disabled={readOnly}
                    onChange={(e) =>
                      setConfiguration((current) => ({
                        ...current,
                        errorCorrection: e.target
                          .value as QRCodeWidgetConfig["errorCorrection"],
                      }))
                    }
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="quartile">Quartile</option>
                    <option value="high">High</option>
                  </Select>
                </label>
              </div>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Speed</span>
                  <Select
                    value={(configuration as TickerWidgetConfig).speed}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        speed: event.target
                          .value as TickerWidgetConfig["speed"],
                      }))
                    }
                  >
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </Select>
                </label>
                <label className="field">
                  <span className="field__label">Direction</span>
                  <Select
                    value={(configuration as TickerWidgetConfig).direction}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        direction: event.target
                          .value as TickerWidgetConfig["direction"],
                      }))
                    }
                  >
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </Select>
                </label>
              </div>
              {(configuration as QRCodeWidgetConfig).value.length > 500 && (
                <div className="notice notice--warning">
                  Dense QR Code. Test scanning at the intended display distance.
                </div>
              )}
            </>
          )}
          {provider === "ticker" && (
            <>
              <label className="field">
                <span className="field__label">Data Source</span>
                <Select
                  value={(configuration as TickerWidgetConfig).dataSourceId}
                  disabled={readOnly}
                  onChange={(e) =>
                    setConfiguration((current) => ({
                      ...current,
                      dataSourceId: e.target.value,
                    }))
                  }
                >
                  <option value="">Select data</option>
                  {compatibleDataSources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="form-grid form-grid--2">
                <fieldset>
                  <legend>Fields (up to three)</legend>
                  <div className="checkbox-grid">
                    {availableFields.map((field) => {
                      const config = configuration as TickerWidgetConfig;
                      const selected = (
                        config.fields ?? [config.field]
                      ).includes(field.key);
                      return (
                        <label key={field.key}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={
                              readOnly ||
                              (!selected &&
                                (config.fields ?? [config.field]).filter(
                                  Boolean,
                                ).length >= 3)
                            }
                            onChange={(event) =>
                              setConfiguration((current) => {
                                const ticker = current as TickerWidgetConfig;
                                const fields = (
                                  ticker.fields ?? [ticker.field]
                                ).filter(Boolean);
                                const next = event.target.checked
                                  ? [...fields, field.key]
                                  : fields.filter((item) => item !== field.key);
                                return {
                                  ...ticker,
                                  fields: next,
                                  field: next[0] ?? "",
                                };
                              })
                            }
                          />
                          <span>{field.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="field">
                  <span className="field__label">Separator</span>
                  <input
                    value={(configuration as TickerWidgetConfig).separator}
                    disabled={readOnly}
                    onChange={(e) =>
                      setConfiguration((current) => ({
                        ...current,
                        separator: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Field separator</span>
                  <input
                    value={
                      (configuration as TickerWidgetConfig).fieldSeparator ??
                      " — "
                    }
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        fieldSeparator: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </>
          )}
          {["menu", "list", "table", "agenda"].includes(provider) && (
            <>
              <label className="field">
                <span className="field__label">Data Source</span>
                <Select
                  value={(configuration as DisplayWidgetConfig).dataSourceId}
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      dataSourceId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select data</option>
                  {compatibleDataSources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </label>
              <fieldset>
                <legend>Displayed fields</legend>
                {!availableFields.length ? (
                  <small>Select a Data Source to choose its fields.</small>
                ) : (
                  <div className="checkbox-grid">
                    {availableFields.map((field) => {
                      const selected = (
                        configuration as DisplayWidgetConfig
                      ).fields.includes(field.key);
                      return (
                        <label key={field.key}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={readOnly}
                            onChange={(event) =>
                              setConfiguration((current) => {
                                const config = current as DisplayWidgetConfig;
                                const fields = event.target.checked
                                  ? [
                                      ...config.fields.filter(
                                        (item) => item !== field.key,
                                      ),
                                      field.key,
                                    ]
                                  : config.fields.filter(
                                      (item) => item !== field.key,
                                    );
                                return { ...config, fields };
                              })
                            }
                          />
                          <span>{field.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>
              {provider === "list" && (
                <div className="form-grid form-grid--2">
                  {(
                    [
                      ["primaryField", "Primary field"],
                      ["secondaryField", "Secondary field"],
                      ["leadingField", "Leading field"],
                      ["trailingField", "Trailing field"],
                    ] as const
                  ).map(([key, label]) => (
                    <FieldSelect
                      key={key}
                      label={label}
                      value={(configuration as DisplayWidgetConfig)[key] ?? ""}
                      fields={availableFields}
                      allowEmpty={key !== "primaryField"}
                      disabled={readOnly}
                      onChange={(value) =>
                        setConfiguration((current) => ({
                          ...current,
                          [key]: value,
                        }))
                      }
                    />
                  ))}
                  <label className="switch-row">
                    <input
                      type="checkbox"
                      checked={
                        (configuration as DisplayWidgetConfig).showDividers ??
                        false
                      }
                      disabled={readOnly}
                      onChange={(event) =>
                        setConfiguration((current) => ({
                          ...current,
                          showDividers: event.target.checked,
                        }))
                      }
                    />
                    <span>Show row dividers</span>
                  </label>
                </div>
              )}
              {provider === "menu" && (
                <div className="form-grid form-grid--2">
                  <label className="field">
                    <span className="field__label">Presentation</span>
                    <Select
                      value={
                        (configuration as DisplayWidgetConfig).mode ??
                        "single_record"
                      }
                      disabled={readOnly}
                      onChange={(event) =>
                        setConfiguration((current) => ({
                          ...(current as DisplayWidgetConfig),
                          mode: event.target
                            .value as DisplayWidgetConfig["mode"],
                        }))
                      }
                    >
                      <option value="single_record">
                        Fields from one record
                      </option>
                      <option value="records">Label and value rows</option>
                    </Select>
                  </label>
                  {(configuration as DisplayWidgetConfig).mode ===
                    "records" && (
                    <>
                      <FieldSelect
                        label="Label field"
                        value={
                          (configuration as DisplayWidgetConfig).labelField ??
                          ""
                        }
                        fields={availableFields}
                        disabled={readOnly}
                        onChange={(labelField) =>
                          setConfiguration((current) => ({
                            ...current,
                            labelField,
                          }))
                        }
                      />
                      <FieldSelect
                        label="Value field"
                        value={
                          (configuration as DisplayWidgetConfig).valueField ??
                          ""
                        }
                        fields={availableFields}
                        disabled={readOnly}
                        onChange={(valueField) =>
                          setConfiguration((current) => ({
                            ...current,
                            valueField,
                          }))
                        }
                      />
                    </>
                  )}
                </div>
              )}
              {provider === "table" && (
                <>
                  <div className="checkbox-grid">
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          (configuration as DisplayWidgetConfig).showHeader ??
                          false
                        }
                        disabled={readOnly}
                        onChange={(event) =>
                          setConfiguration((current) => ({
                            ...current,
                            showHeader: event.target.checked,
                          }))
                        }
                      />
                      <span>Show column headers</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          (configuration as DisplayWidgetConfig)
                            .alternatingRows ?? false
                        }
                        disabled={readOnly}
                        onChange={(event) =>
                          setConfiguration((current) => ({
                            ...current,
                            alternatingRows: event.target.checked,
                          }))
                        }
                      />
                      <span>Alternate row backgrounds</span>
                    </label>
                  </div>
                  <fieldset>
                    <legend>Column presentation</legend>
                    {(configuration as DisplayWidgetConfig).fields.map(
                      (fieldKey) => {
                        const config = configuration as DisplayWidgetConfig;
                        const existing = config.columns?.find(
                          (column) => column.field === fieldKey,
                        ) ?? {
                          field: fieldKey,
                          label:
                            availableFields.find(
                              (field) => field.key === fieldKey,
                            )?.label ?? fieldKey,
                          format: "text" as const,
                          alignment: "left" as const,
                          width: 0,
                        };
                        const updateColumn = (patch: Partial<FieldFormat>) =>
                          setConfiguration((current) => {
                            const table = current as DisplayWidgetConfig;
                            const columns = table.fields.map((key) => {
                              const column = table.columns?.find(
                                (item) => item.field === key,
                              ) ?? { field: key };
                              return key === fieldKey
                                ? { ...column, ...existing, ...patch }
                                : column;
                            });
                            return { ...table, columns };
                          });
                        return (
                          <div
                            className="form-grid form-grid--4"
                            key={fieldKey}
                          >
                            <label className="field">
                              <span className="field__label">Label</span>
                              <input
                                value={existing.label ?? ""}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateColumn({ label: event.target.value })
                                }
                              />
                            </label>
                            <label className="field">
                              <span className="field__label">Format</span>
                              <Select
                                value={existing.format ?? "text"}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateColumn({
                                    format: event.target
                                      .value as FieldFormat["format"],
                                  })
                                }
                              >
                                <option value="text">Text</option>
                                <option value="number">Number</option>
                                <option value="integer">Integer</option>
                                <option value="percent">Percent</option>
                                <option value="currency">Currency</option>
                                <option value="date-short">Short date</option>
                                <option value="date-long">Long date</option>
                              </Select>
                            </label>
                            <label className="field">
                              <span className="field__label">Alignment</span>
                              <Select
                                value={existing.alignment ?? "left"}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateColumn({
                                    alignment: event.target
                                      .value as FieldFormat["alignment"],
                                  })
                                }
                              >
                                <option value="left">Left</option>
                                <option value="center">Center</option>
                                <option value="right">Right</option>
                              </Select>
                            </label>
                            <label className="field">
                              <span className="field__label">Width %</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={existing.width ?? 0}
                                disabled={readOnly}
                                onChange={(event) =>
                                  updateColumn({
                                    width: Number(event.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                        );
                      },
                    )}
                  </fieldset>
                </>
              )}
              {provider === "agenda" && (
                <div className="form-grid form-grid--2">
                  {(
                    [
                      ["dateField", "Date field"],
                      ["timeField", "Time field"],
                      ["titleField", "Title field"],
                      ["locationField", "Location field"],
                      ["descriptionField", "Description field"],
                    ] as const
                  ).map(([key, label]) => (
                    <FieldSelect
                      key={key}
                      label={label}
                      value={(configuration as DisplayWidgetConfig)[key] ?? ""}
                      fields={availableFields}
                      allowEmpty={key !== "titleField"}
                      disabled={readOnly}
                      onChange={(value) =>
                        setConfiguration((current) => ({
                          ...current,
                          [key]: value,
                        }))
                      }
                    />
                  ))}
                </div>
              )}
              <label className="field">
                <span className="field__label">Maximum items</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={(configuration as DisplayWidgetConfig).maximumItems}
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      maximumItems: Number(event.target.value),
                    }))
                  }
                />
              </label>
              <label className="field">
                <span className="field__label">Empty state</span>
                <input
                  value={
                    (configuration as DisplayWidgetConfig).emptyState ?? ""
                  }
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      emptyState: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          )}
          {provider === "metric" && (
            <>
              <DataSourceSelect
                value={(configuration as MetricWidgetConfig).dataSourceId}
                sources={compatibleDataSources}
                disabled={readOnly}
                onChange={(dataSourceId) =>
                  setConfiguration((current) => ({
                    ...current,
                    dataSourceId,
                  }))
                }
              />
              <div className="form-grid form-grid--2">
                <FieldSelect
                  label="Value field"
                  value={(configuration as MetricWidgetConfig).valueField}
                  fields={availableFields.filter((field) =>
                    ["number", "integer", "percent", "currency"].includes(
                      field.type,
                    ),
                  )}
                  disabled={readOnly}
                  onChange={(valueField) =>
                    setConfiguration((current) => ({
                      ...current,
                      valueField,
                    }))
                  }
                />
                <label className="field">
                  <span className="field__label">Static label</span>
                  <input
                    value={(configuration as MetricWidgetConfig).label ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                  />
                </label>
                <FieldSelect
                  label="Label field"
                  value={(configuration as MetricWidgetConfig).labelField ?? ""}
                  fields={availableFields}
                  allowEmpty
                  disabled={readOnly}
                  onChange={(labelField) =>
                    setConfiguration((current) => ({
                      ...current,
                      labelField,
                    }))
                  }
                />
                <FieldSelect
                  label="Secondary field"
                  value={
                    (configuration as MetricWidgetConfig).secondaryField ?? ""
                  }
                  fields={availableFields}
                  allowEmpty
                  disabled={readOnly}
                  onChange={(secondaryField) =>
                    setConfiguration((current) => ({
                      ...current,
                      secondaryField,
                    }))
                  }
                />
                <label className="field">
                  <span className="field__label">Format</span>
                  <Select
                    value={(configuration as MetricWidgetConfig).format}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...(current as MetricWidgetConfig),
                        format: event.target
                          .value as MetricWidgetConfig["format"],
                      }))
                    }
                  >
                    <option value="number">Number</option>
                    <option value="integer">Integer</option>
                    <option value="percent">Percent</option>
                    <option value="currency">Currency</option>
                  </Select>
                </label>
                <label className="field">
                  <span className="field__label">Decimal places</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={(configuration as MetricWidgetConfig).precision}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        precision: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Prefix</span>
                  <input
                    value={(configuration as MetricWidgetConfig).prefix ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        prefix: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Suffix</span>
                  <input
                    value={(configuration as MetricWidgetConfig).suffix ?? ""}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        suffix: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Alignment</span>
                  <Select
                    value={(configuration as MetricWidgetConfig).alignment}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        alignment: event.target
                          .value as MetricWidgetConfig["alignment"],
                      }))
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </Select>
                </label>
              </div>
              <label className="field">
                <span className="field__label">Empty state</span>
                <input
                  value={(configuration as TickerWidgetConfig).emptyState ?? ""}
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      emptyState: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          )}
          {provider === "cards" && (
            <>
              <DataSourceSelect
                value={(configuration as CardsWidgetConfig).dataSourceId}
                sources={compatibleDataSources}
                disabled={readOnly}
                onChange={(dataSourceId) =>
                  setConfiguration((current) => ({
                    ...current,
                    dataSourceId,
                  }))
                }
              />
              <div className="form-grid form-grid--2">
                <FieldSelect
                  label="Title field"
                  value={(configuration as CardsWidgetConfig).titleField}
                  fields={availableFields}
                  disabled={readOnly}
                  onChange={(titleField) =>
                    setConfiguration((current) => ({
                      ...current,
                      titleField,
                    }))
                  }
                />
                {(["subtitleField", "bodyField", "badgeField"] as const).map(
                  (key) => (
                    <FieldSelect
                      key={key}
                      label={key.replace("Field", "")}
                      value={(configuration as CardsWidgetConfig)[key] ?? ""}
                      fields={availableFields}
                      allowEmpty
                      disabled={readOnly}
                      onChange={(value) =>
                        setConfiguration((current) => ({
                          ...current,
                          [key]: value,
                        }))
                      }
                    />
                  ),
                )}
                <label className="field">
                  <span className="field__label">Columns</span>
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={(configuration as CardsWidgetConfig).columns}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...(current as CardsWidgetConfig),
                        columns: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Maximum items</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={(configuration as CardsWidgetConfig).maximumItems}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        maximumItems: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span className="field__label">Density</span>
                  <Select
                    value={(configuration as CardsWidgetConfig).density}
                    disabled={readOnly}
                    onChange={(event) =>
                      setConfiguration((current) => ({
                        ...current,
                        density: event.target
                          .value as CardsWidgetConfig["density"],
                      }))
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </Select>
                </label>
              </div>
            </>
          )}
          {provider === "weather" && (
            <>
              <DataSourceSelect
                value={(configuration as WeatherWidgetConfig).dataSourceId}
                sources={compatibleDataSources}
                disabled={readOnly}
                onChange={(dataSourceId) =>
                  setConfiguration((current) => ({
                    ...current,
                    dataSourceId,
                  }))
                }
              />
              <div className="checkbox-grid">
                {[
                  ["showLocation", "Location"],
                  ["showCurrent", "Current conditions"],
                  ["showHumidity", "Humidity"],
                  ["showWind", "Wind"],
                  ["showPrecipitation", "Precipitation"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(
                        (configuration as unknown as Record<string, unknown>)[
                          key!
                        ],
                      )}
                      disabled={readOnly}
                      onChange={(event) =>
                        setConfiguration((current) => ({
                          ...current,
                          [key!]: event.target.checked,
                        }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <label className="field">
                <span className="field__label">Forecast days</span>
                <input
                  type="number"
                  min={0}
                  max={7}
                  value={(configuration as WeatherWidgetConfig).forecastDays}
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      forecastDays: Number(event.target.value),
                    }))
                  }
                />
              </label>
            </>
          )}
          <fieldset>
            <legend>Content sizing</legend>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={configuration.textScale !== undefined}
                disabled={readOnly}
                onChange={(event) =>
                  setConfiguration((current) => {
                    if (event.target.checked)
                      return { ...current, textScale: 100 };
                    const automatic = { ...current };
                    delete automatic.textScale;
                    return automatic;
                  })
                }
              />
              <span>Use a custom scale</span>
            </label>
            {configuration.textScale !== undefined && (
              <label className="field">
                <span className="field__label">
                  Scale ({configuration.textScale}%)
                </span>
                <input
                  type="range"
                  min={25}
                  max={500}
                  step={25}
                  value={configuration.textScale}
                  disabled={readOnly}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      textScale: Number(event.target.value),
                    }))
                  }
                />
              </label>
            )}
            <label className="field">
              <span className="field__label">
                Padding ({configuration.contentPadding ?? 10}%)
              </span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={configuration.contentPadding ?? 10}
                disabled={readOnly}
                onChange={(event) =>
                  setConfiguration((current) => ({
                    ...current,
                    contentPadding: Number(event.target.value),
                  }))
                }
              />
            </label>
            <small>
              By default, content uses the center 80% of the Widget. Reduce
              padding to let it fill more space; custom scale ranges up to 500%
              and still fits long text within the available area.
            </small>
          </fieldset>
          <div className="form-grid form-grid--2">
            <label className="field">
              <span className="field__label">Foreground</span>
              <input
                type="color"
                value={configuration.foregroundColor}
                disabled={readOnly}
                onChange={(e) =>
                  updateColors("foregroundColor", e.target.value)
                }
              />
            </label>
            <label className="field">
              <span className="field__label">Background</span>
              <input
                type="color"
                value={configuration.backgroundColor}
                disabled={readOnly}
                onChange={(e) =>
                  updateColors("backgroundColor", e.target.value)
                }
              />
            </label>
          </div>
          <div
            className="native-app-preview"
            style={{
              color: configuration.foregroundColor,
              backgroundColor: configuration.backgroundColor,
              fontSize: `${configuration.textScale ?? 100}%`,
              padding: `${configuration.contentPadding ?? 10}%`,
            }}
          >
            {compiledPreview.data ? (
              <DeclarativePresentationPreview
                presentation={compiledPreview.data}
                source={sourcePreview.data}
              />
            ) : compiledPreview.isLoading || sourcePreview.isLoading ? (
              "Compiling presentation preview…"
            ) : (
              "The current configuration cannot be compiled yet."
            )}
          </div>
          {save.error && <p className="form-error">{save.error.message}</p>}
        </div>
        <footer>
          {!readOnly && (
            <button
              className="button button--primary"
              disabled={save.isPending || !name.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save Widget"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function DeclarativePresentationPreview({
  presentation,
  source,
}: {
  presentation: WidgetPresentation;
  source: unknown;
}) {
  if (presentation.kind === "web") {
    return (
      <div>
        <strong>Sandboxed web</strong>
        <br />
        {presentation.web?.url ?? "Local signed bundle"}
        <br />
        <small>{presentation.web?.lifecycle ?? "destroy_on_hide"}</small>
      </div>
    );
  }
  const records = previewRecordMaps(source);
  const root = presentation.native?.root;
  return root ? (
    <PreviewNode node={root} records={records} />
  ) : (
    "Presentation root is unavailable."
  );
}

function PreviewNode({
  node,
  records,
  record,
}: {
  node: PresentationNode;
  records: Record<string, string>[];
  record?: Record<string, string>;
}) {
  const props = node.props ?? {};
  const binding = node.binding;
  const resolve = () => {
    if (!binding) return "";
    if (binding.source === "literal") return binding.value ?? "";
    if (binding.source === "repeat")
      return record?.[binding.path ?? ""] ?? binding.fallback ?? "";
    if (binding.source === "dataset")
      return records
        .map((item) =>
          (binding.fields ?? [])
            .map((field) => item[field])
            .filter(Boolean)
            .join(" "),
        )
        .filter(Boolean)
        .join(binding.separator ?? " ");
    if (binding.source === "environment") {
      const format = binding.format?.split(":") ?? [];
      const timezone = format.at(-1) || "UTC";
      if (format[0] === "date")
        return new Intl.DateTimeFormat(undefined, {
          dateStyle:
            (format[1] as "full" | "long" | "medium" | "short") ?? "full",
          timeZone: timezone,
        }).format(new Date());
      if (format[0] === "time")
        return new Intl.DateTimeFormat(undefined, {
          timeStyle: format[2] === "true" ? "medium" : "short",
          hour12: format[1] !== "24",
          timeZone: timezone,
        }).format(new Date());
      if (format[0] === "countdown") return "12d 4h 32m";
    }
    return binding.fallback ?? "";
  };
  if (node.type === "repeat") {
    return (
      <>
        {records.slice(0, node.repeat?.limit ?? 20).map((item, index) => (
          <div key={item.id ?? index}>
            {node.children?.map((child, childIndex) => (
              <PreviewNode
                key={child.id ?? childIndex}
                node={child}
                records={records}
                record={item}
              />
            ))}
          </div>
        ))}
      </>
    );
  }
  if (node.type === "qr_code")
    return <div aria-label="QR Code preview">▦ {resolve()}</div>;
  if (["text", "badge", "marquee"].includes(node.type))
    return (
      <span className={`presentation-preview__${node.type}`}>{resolve()}</span>
    );
  const direction = node.type === "row" ? "row" : "column";
  return (
    <div
      className={`presentation-preview__${node.type}`}
      style={{
        display: "flex",
        flexDirection: direction,
        gap: `${Number(props.gap ?? 8)}px`,
        background:
          typeof props.backgroundColor === "string"
            ? props.backgroundColor
            : undefined,
        padding: `${Number(props.padding ?? 0)}px`,
      }}
    >
      {node.children?.map((child, index) => (
        <PreviewNode
          key={child.id ?? index}
          node={child}
          records={records}
          record={record}
        />
      ))}
    </div>
  );
}

function previewRecordMaps(value: unknown): Record<string, string>[] {
  if (!value || typeof value !== "object") return [];
  const root = value as Record<string, unknown>;
  const direct = Array.isArray(root.records) ? root.records : undefined;
  const configuration =
    root.configuration && typeof root.configuration === "object"
      ? (root.configuration as Record<string, unknown>)
      : undefined;
  const data =
    configuration?.data && typeof configuration.data === "object"
      ? (configuration.data as Record<string, unknown>)
      : undefined;
  const records = direct ?? (Array.isArray(data?.records) ? data.records : []);
  return records.slice(0, 12).map((item, index) => {
    if (!item || typeof item !== "object") return { id: String(index) };
    const record = item as Record<string, unknown>;
    const values =
      record.values && typeof record.values === "object"
        ? (record.values as Record<string, unknown>)
        : record;
    return Object.fromEntries(
      Object.entries(values).map(([key, entry]) => [
        key,
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
          ? String(entry)
          : "",
      ]),
    );
  });
}

function DataSourceSelect({
  value,
  sources,
  disabled,
  onChange,
}: {
  value: string;
  sources: DataSource[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">Data Source</span>
      <Select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select data</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

function FieldSelect({
  label,
  value,
  fields,
  disabled,
  allowEmpty = false,
  onChange,
}: {
  label: string;
  value: string;
  fields: DataSourceField[];
  disabled?: boolean;
  allowEmpty?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <Select
        value={value}
        disabled={disabled || fields.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {allowEmpty ? "None" : "Select a Data Source first"}
        </option>
        {fields.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label}
          </option>
        ))}
      </Select>
    </label>
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
  page = false,
}: {
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
  page?: boolean;
}) {
  const queryClient = useQueryClient();
  const configured = asset?.widget?.configuration as YouTubeConfig | undefined;
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
        ? api.updateWidget(asset.id, input, csrf)
        : api.createWidget(input, csrf);
    },
    onSuccess: (saved) => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  const close = () => {
    if (!dirty || confirm("Discard unsaved YouTube Widget changes?")) onClose();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!dirty || confirm("Discard unsaved YouTube Widget changes?"))
          onClose();
      }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [dirty, onClose]);
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="asset-details source-editor"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="youtube-source-title"
      >
        <header>
          <div>
            <h2 id="youtube-source-title">
              {asset ? "Edit YouTube Widget" : "Create YouTube Widget"}
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
          <Select
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
          </Select>
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
          <Select
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
          </Select>
        </label>
        <label className="field">
          <span className="field__label">Fallback image</span>
          <Select
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
          </Select>
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
              {save.isPending ? "Saving…" : "Save Widget"}
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
