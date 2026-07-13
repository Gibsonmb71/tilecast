import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe2, X, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Asset, SourceProvider, YouTubeConfig } from "../api/types";

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
        </div>
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
