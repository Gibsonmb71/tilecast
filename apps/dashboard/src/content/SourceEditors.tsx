import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock3,
  QrCode,
  TextQuote,
  Globe2,
  ListTree,
  Table2,
  Utensils,
  X,
  Youtube,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api } from "../api/client";
import type {
  Asset,
  WidgetProvider,
  ClockWidgetConfig,
  DateWidgetConfig,
  QRCodeWidgetConfig,
  TickerWidgetConfig,
  DisplayWidgetConfig,
  YouTubeConfig,
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
            <p>Choose a built-in Widget provider.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          <h3 className="source-provider-group-title">Web and video</h3>
          <button type="button" onClick={() => onChoose("website")}>
            <Globe2 size={30} />
            <strong>Website</strong>
            <span>Display an approved webpage.</span>
          </button>
          <button type="button" onClick={() => onChoose("youtube")}>
            <Youtube size={30} />
            <strong>YouTube</strong>
            <span>Play a YouTube video or playlist without an API key.</span>
          </button>
          <h3 className="source-provider-group-title">Basic</h3>
          <button type="button" onClick={() => onChoose("clock")}>
            <Clock3 size={30} />
            <strong>Clock</strong>
            <span>Show a live local time using a configured timezone.</span>
          </button>
          <button type="button" onClick={() => onChoose("date")}>
            <CalendarDays size={30} />
            <strong>Date</strong>
            <span>Show a live localized calendar date.</span>
          </button>
          <button type="button" onClick={() => onChoose("qrcode")}>
            <QrCode size={30} />
            <strong>QR Code</strong>
            <span>Display validated text or a URL as a scannable code.</span>
          </button>
          <h3 className="source-provider-group-title">Data</h3>
          <button type="button" onClick={() => onChoose("ticker")}>
            <TextQuote size={30} />
            <strong>Ticker</strong>
            <span>Scroll a selected field from a Data Source.</span>
          </button>
          <button type="button" onClick={() => onChoose("menu")}>
            <Utensils size={30} />
            <strong>Menu</strong>
            <span>Format selected CSV or JSON fields as a signage menu.</span>
          </button>
          <button type="button" onClick={() => onChoose("list")}>
            <ListTree size={30} />
            <strong>List</strong>
            <span>Present records from a reusable Data Source.</span>
          </button>
          <button type="button" onClick={() => onChoose("table")}>
            <Table2 size={30} />
            <strong>Table</strong>
            <span>Show selected CSV or JSON fields in columns.</span>
          </button>
          <button type="button" onClick={() => onChoose("agenda")}>
            <CalendarDays size={30} />
            <strong>Agenda</strong>
            <span>Display dated Data Source records in agenda form.</span>
          </button>
        </div>
      </section>
    </div>
  );
}

type NativeProvider =
  "clock" | "date" | "qrcode" | "ticker" | "menu" | "list" | "table" | "agenda";
type NativeConfig =
  | ClockWidgetConfig
  | DateWidgetConfig
  | QRCodeWidgetConfig
  | TickerWidgetConfig
  | DisplayWidgetConfig;
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
  if (["menu", "list", "table", "agenda"].includes(provider))
    return {
      dataSourceId: "",
      fields: ["title", "subtitle"],
      maximumItems: provider === "menu" ? 2 : 20,
      ...colors,
    };
  return {
    dataSourceId: "",
    field: "title",
    separator: " • ",
    speed: "normal",
    direction: "left",
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
    enabled: ["ticker", "menu", "list", "table", "agenda"].includes(provider),
  });
  const acceptedProviders: Record<string, string[]> = {
    ticker: ["rss", "atom", "calendar", "json", "csv"],
    menu: ["csv", "json"],
    list: ["calendar", "rss", "atom", "json", "csv"],
    table: ["json", "csv"],
    agenda: ["calendar", "json", "csv"],
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
  ].includes(provider)
    ? (configuration as TickerWidgetConfig | DisplayWidgetConfig).dataSourceId
    : "";
  const selectedDataSource = useQuery({
    queryKey: ["widget-data-source", selectedDataSourceId],
    queryFn: () => api.getDataSource(selectedDataSourceId),
    enabled: Boolean(selectedDataSourceId),
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
            <p>Reusable native Widget configuration.</p>
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
                <select
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
                </select>
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
              <select
                value={(configuration as DateWidgetConfig).format}
                disabled={readOnly}
                onChange={(e) =>
                  setConfiguration((current) => ({
                    ...current,
                    format: e.target.value as DateWidgetConfig["format"],
                  }))
                }
              >
                <option value="full">Full</option>
                <option value="long">Long</option>
                <option value="medium">Medium</option>
                <option value="short">Short</option>
              </select>
            </label>
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
                  <select
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
                  </select>
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
                <select
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
                </select>
              </label>
              <div className="form-grid form-grid--2">
                <label className="field">
                  <span className="field__label">Field</span>
                  <select
                    value={(configuration as TickerWidgetConfig).field}
                    disabled={readOnly || !availableFields.length}
                    onChange={(e) =>
                      setConfiguration((current) => ({
                        ...current,
                        field: e.target.value,
                      }))
                    }
                  >
                    {!availableFields.length && (
                      <option value="">Select a Data Source first</option>
                    )}
                    {availableFields.map((field) => (
                      <option key={field.key} value={field.key}>
                        {field.label}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>
            </>
          )}
          {["menu", "list", "table", "agenda"].includes(provider) && (
            <>
              <label className="field">
                <span className="field__label">Data Source</span>
                <select
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
                </select>
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
            </>
          )}
          <fieldset>
            <legend>Text size</legend>
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
                  min={50}
                  max={200}
                  step={5}
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
            <small>
              Automatic sizing responds to the Widget’s actual space. A custom
              scale adjusts that result and still shrinks long text to avoid
              clipping.
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
            }}
          >
            {provider === "clock" ? (
              new Intl.DateTimeFormat(undefined, {
                timeStyle: (configuration as ClockWidgetConfig).showSeconds
                  ? "medium"
                  : "short",
                timeZone: (configuration as ClockWidgetConfig).timezone,
              }).format(new Date())
            ) : provider === "date" ? (
              new Intl.DateTimeFormat(undefined, {
                dateStyle: (configuration as DateWidgetConfig).format,
                timeZone: (configuration as DateWidgetConfig).timezone,
              }).format(new Date())
            ) : provider === "qrcode" ? (
              <QRCodePreview
                configuration={configuration as QRCodeWidgetConfig}
              />
            ) : (
              "Preview uses the selected Data Source."
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

function QRCodePreview({
  configuration,
}: {
  configuration: QRCodeWidgetConfig;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current || !configuration.value) return;
    void QRCode.toCanvas(canvas.current, configuration.value, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: { low: "L", medium: "M", quartile: "Q", high: "H" }[
        configuration.errorCorrection
      ] as "L" | "M" | "Q" | "H",
      color: {
        dark: configuration.foregroundColor,
        light: configuration.backgroundColor,
      },
    });
  }, [configuration]);
  return (
    <>
      <canvas ref={canvas} aria-label="QR Code preview" />
      {configuration.label && <small>{configuration.label}</small>}
    </>
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
