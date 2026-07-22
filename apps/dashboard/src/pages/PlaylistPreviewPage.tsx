import { useQuery } from "@tanstack/react-query";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { api } from "../api/client";
import type { PlaylistItem } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

export function nextPlaylistPreviewItem(
  index: number,
  length: number,
  direction = 1,
) {
  if (length <= 0) return 0;
  return (index + direction + length) % length;
}

export function playlistPreviewItemDuration(item: PlaylistItem) {
  if (item.assetType === "video") return undefined;
  return item.durationMs && item.durationMs > 0 ? item.durationMs : 10_000;
}

function mediaStyle(item: PlaylistItem) {
  return {
    objectFit: item.fitMode === "stretch" ? ("fill" as const) : item.fitMode,
  };
}

export function PlaylistPreviewPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const auth = useAuth();
  const query = useQuery({
    queryKey: ["playlists", id, "popup-preview"],
    queryFn: () => api.playlist(id),
    enabled: Boolean(id && auth.status?.authenticated),
  });
  const items = useMemo(
    () =>
      (query.data?.items ?? []).filter((item) => item.assetStatus === "ready"),
    [query.data?.items],
  );
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const current = items[index % Math.max(items.length, 1)];

  const move = useCallback(
    (direction: number) => {
      setIndex((value) =>
        nextPlaylistPreviewItem(value, items.length, direction),
      );
    },
    [items.length],
  );
  const advance = useCallback(() => move(1), [move]);

  useEffect(() => {
    setIndex(0);
  }, [query.data?.id, query.data?.revision]);
  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [index, items.length]);
  useEffect(() => setFailed(false), [current?.id]);
  useEffect(() => {
    if (!query.data) return;
    const previous = document.title;
    document.title = `${query.data.name} preview · Tilecast`;
    return () => {
      document.title = previous;
    };
  }, [query.data]);
  useEffect(() => {
    if (!current || paused || current.assetType === "video") return;
    const timer = window.setTimeout(
      advance,
      playlistPreviewItemDuration(current),
    );
    return () => window.clearTimeout(timer);
  }, [advance, current, paused]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [current?.id, paused]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") move(1);
      else if (event.key === "ArrowLeft") move(-1);
      else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      } else return;
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [move]);

  if (auth.isLoading)
    return <main className="playlist-preview-page">Loading preview…</main>;
  if (!auth.status?.authenticated) {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate
        to={
          auth.status?.setupRequired
            ? "/setup"
            : `/login?returnTo=${encodeURIComponent(returnTo)}`
        }
        replace
      />
    );
  }
  if (query.isLoading)
    return <main className="playlist-preview-page">Loading preview…</main>;
  if (query.isError || !query.data)
    return (
      <main className="playlist-preview-page playlist-preview-page--message">
        <strong>Playlist preview unavailable</strong>
        <span>
          {query.error instanceof Error
            ? query.error.message
            : "The playlist could not be loaded."}
        </span>
      </main>
    );

  return (
    <main className="playlist-preview-page">
      <header className="playlist-preview-page__header">
        <div>
          <strong>{query.data.name}</strong>
          <span aria-live="polite">
            {current
              ? `${index + 1} of ${items.length} · ${current.assetName}`
              : "No ready items"}
          </span>
        </div>
        <button
          type="button"
          className="playlist-preview-page__control"
          onClick={() => window.close()}
          aria-label="Close preview"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <section
        className="playlist-preview-page__stage"
        aria-label="Playlist preview"
      >
        {!current ? (
          <div className="playlist-preview-page__empty">
            <strong>No ready items</strong>
            <span>Add ready content to preview this playlist.</span>
          </div>
        ) : failed ? (
          <div className="playlist-preview-page__empty">
            <strong>{current.assetName}</strong>
            <span>This item could not be previewed in Studio.</span>
          </div>
        ) : current.assetType === "video" ? (
          <video
            ref={videoRef}
            key={current.id}
            className={`playlist-preview-page__media playlist-preview-page__media--${current.transition}`}
            src={api.assetPreviewUrl(current.assetId)}
            style={mediaStyle(current)}
            autoPlay={!paused}
            playsInline
            muted={muted || !current.audioEnabled}
            preload="auto"
            onLoadedMetadata={(event) => {
              event.currentTarget.volume = current.volume;
              if (current.videoStartOffsetMs)
                event.currentTarget.currentTime =
                  current.videoStartOffsetMs / 1000;
            }}
            onTimeUpdate={(event) => {
              if (
                current.videoEndOffsetMs &&
                event.currentTarget.currentTime >=
                  current.videoEndOffsetMs / 1000
              )
                advance();
            }}
            onEnded={advance}
            onError={() => setFailed(true)}
          />
        ) : (
          <img
            key={current.id}
            className={`playlist-preview-page__media playlist-preview-page__media--${current.transition}`}
            src={
              current.assetType === "image"
                ? api.assetPreviewUrl(current.assetId)
                : current.thumbnailUrl
            }
            style={mediaStyle(current)}
            alt=""
            onError={() => setFailed(true)}
          />
        )}
      </section>

      <footer className="playlist-preview-page__footer">
        <button
          type="button"
          className="playlist-preview-page__control"
          onClick={() => move(-1)}
          disabled={!current}
          aria-label="Previous item"
        >
          <SkipBack size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="playlist-preview-page__control"
          onClick={() => setPaused((value) => !value)}
          disabled={!current}
          aria-label={paused ? "Resume preview" : "Pause preview"}
        >
          {paused ? (
            <Play size={22} aria-hidden="true" />
          ) : (
            <Pause size={22} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="playlist-preview-page__control"
          onClick={() => move(1)}
          disabled={!current}
          aria-label="Next item"
        >
          <SkipForward size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="playlist-preview-page__control playlist-preview-page__control--mute"
          onClick={() => setMuted((value) => !value)}
          disabled={!current}
          aria-label={muted ? "Unmute preview" : "Mute preview"}
        >
          {muted ? (
            <VolumeX size={20} aria-hidden="true" />
          ) : (
            <Volume2 size={20} aria-hidden="true" />
          )}
        </button>
      </footer>
    </main>
  );
}
