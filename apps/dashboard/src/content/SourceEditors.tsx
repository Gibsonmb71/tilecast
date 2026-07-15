import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Globe2, Plus, Trash2, X, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type {
  Asset,
  CalendarConfig,
  CalendarPreview,
  SourceProvider,
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
        </div>
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
