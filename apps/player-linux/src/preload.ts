import { contextBridge, ipcRenderer } from "electron";
import type { StoredManifest } from "./core/manifest";
import type { Presentation, PresentationItem } from "./core/player";
import {
  enrichSynchronizedPresentation,
  projectSynchronizedPresentation,
  synchronizedPlaybackPosition,
  type SynchronizedPlayingPresentation,
  type SynchronizedPlaybackPosition,
} from "./core/synchronized-playback";
import { StateStore, defaultDataDir } from "./core/storage";

interface SyncPositionEvent {
  itemId: string;
  kind: PresentationItem["kind"];
  offsetMs: number;
  occurrence: number;
  videoStartOffsetMs: number;
}

type PresentCallback = (presentation: unknown) => void;
type SyncPositionCallback = (position: SyncPositionEvent | null) => void;

const store = new StateStore(process.env.TILECAST_DATA_DIR ?? defaultDataDir());
const presentCallbacks = new Set<PresentCallback>();
const syncPositionCallbacks = new Set<SyncPositionCallback>();

let activeSynchronized: SynchronizedPlayingPresentation | null = null;
let lastOccurrence: number | null = null;
let lastItemId: string | null = null;
let lastPresentation: unknown = null;
let lastSyncPosition: SyncPositionEvent | null = null;
let boundaryTimer: NodeJS.Timeout | null = null;
let driftTimer: NodeJS.Timeout | null = null;
let presentationRequest = 0;
let syntheticGeneration = 1_000_000_000;

function emitPresentation(presentation: unknown): void {
  lastPresentation = presentation;
  for (const callback of presentCallbacks) {
    callback(presentation);
  }
}

function emitSyncPosition(position: SyncPositionEvent | null): void {
  lastSyncPosition = position;
  for (const callback of syncPositionCallbacks) {
    callback(position);
  }
}

function clearSyncTimers(): void {
  if (boundaryTimer) {
    clearTimeout(boundaryTimer);
    boundaryTimer = null;
  }
  if (driftTimer) {
    clearInterval(driftTimer);
    driftTimer = null;
  }
}

function positionEvent(
  presentation: SynchronizedPlayingPresentation,
  position: SynchronizedPlaybackPosition,
): SyncPositionEvent {
  const item = presentation.items[position.index]!;
  return {
    itemId: item.id,
    kind: item.kind,
    offsetMs: position.offsetMs,
    occurrence: position.occurrence,
    videoStartOffsetMs: item.videoStartOffsetMs ?? 0,
  };
}

function scheduleBoundary(position: SynchronizedPlaybackPosition): void {
  if (boundaryTimer) {
    clearTimeout(boundaryTimer);
  }
  boundaryTimer = setTimeout(
    () => emitExpectedSynchronizedPosition(false),
    position.remainingMs + 5,
  );
  boundaryTimer.unref?.();
}

function emitExpectedSynchronizedPosition(force: boolean): void {
  const presentation = activeSynchronized;
  if (!presentation) {
    return;
  }

  const position = synchronizedPlaybackPosition(
    presentation.synchronizedPlayback,
    Date.now(),
  );
  emitSyncPosition(positionEvent(presentation, position));

  if (!force && position.occurrence === lastOccurrence) {
    scheduleBoundary(position);
    return;
  }

  if (lastOccurrence !== null) {
    ipcRenderer.send("progress", {
      itemId: lastItemId,
      kind: "item-transition",
    });
  }

  const projected = projectSynchronizedPresentation(
    presentation,
    position,
    syntheticGeneration++,
  );
  lastOccurrence = position.occurrence;
  lastItemId = presentation.items[position.index]?.id ?? null;
  emitPresentation(projected);
  scheduleBoundary(position);
}

function activatePresentation(
  presentation: Presentation | SynchronizedPlayingPresentation,
): void {
  clearSyncTimers();
  if (
    presentation.state !== "playing" ||
    !("synchronizedPlayback" in presentation)
  ) {
    activeSynchronized = null;
    lastOccurrence = null;
    lastItemId = null;
    emitSyncPosition(null);
    emitPresentation(presentation);
    return;
  }

  activeSynchronized = presentation;
  lastOccurrence = null;
  lastItemId = null;
  emitExpectedSynchronizedPosition(true);
  driftTimer = setInterval(() => {
    const active = activeSynchronized;
    if (!active) {
      return;
    }
    const position = synchronizedPlaybackPosition(
      active.synchronizedPlayback,
      Date.now(),
    );
    if (position.occurrence !== lastOccurrence) {
      emitExpectedSynchronizedPosition(false);
    } else {
      emitSyncPosition(positionEvent(active, position));
    }
  }, 250);
  driftTimer.unref?.();
}

ipcRenderer.on("present", (_event, presentation: Presentation) => {
  const request = ++presentationRequest;
  void (async () => {
    let stored: StoredManifest | null = null;
    if (presentation.state === "playing") {
      stored = await store.readJson<StoredManifest>("manifest-active.json");
    }
    if (request !== presentationRequest) {
      return;
    }
    activatePresentation(enrichSynchronizedPresentation(presentation, stored));
  })();
});

/** Minimal, typed bridge; the renderer has no Node access. */
contextBridge.exposeInMainWorld("tilecast", {
  onPresent(callback: PresentCallback): void {
    presentCallbacks.add(callback);
    if (lastPresentation !== null) {
      callback(lastPresentation);
    }
  },
  onSyncPosition(callback: SyncPositionCallback): void {
    syncPositionCallbacks.add(callback);
    callback(lastSyncPosition);
  },
  onIdentify(
    callback: (data: { name: string; durationSeconds: number }) => void,
  ): void {
    ipcRenderer.on("identify", (_event, data) => callback(data));
  },
  onRetryItem(callback: () => void): void {
    ipcRenderer.on("retry-item", () => callback());
  },
  onSkipItem(callback: () => void): void {
    ipcRenderer.on("skip-item", () => callback());
  },
  reportProgress(itemId: string | null, kind: string): void {
    ipcRenderer.send("progress", { itemId, kind });
  },
  reportPlaybackError(itemId: string | null, message: string): void {
    ipcRenderer.send("playback-error", { itemId, message });
  },
  reportWebsiteRecovered(): void {
    ipcRenderer.send("website-recovered");
  },
  submitServerUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke("setup-server-url", url);
  },
  onDiscoveredServer(
    callback: (server: { name: string; serverUrl: string }) => void,
  ): void {
    ipcRenderer.on("discovered-server", (_event, server) => callback(server));
  },
  listDiscoveredServers(): Promise<{ name: string; serverUrl: string }[]> {
    return ipcRenderer.invoke("list-discovered-servers");
  },
});
