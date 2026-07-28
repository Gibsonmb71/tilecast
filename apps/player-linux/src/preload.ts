import { contextBridge, ipcRenderer } from "electron";
import type { StoredManifest } from "./core/manifest";
import type { Presentation, PresentationItem } from "./core/player";
import type { ManifestPlugin } from "./core/types";
import {
  activateSynchronizedClock,
  enrichSynchronizedPresentation,
  projectSynchronizedPresentation,
  synchronizedNowMs,
  synchronizedPlaybackPosition,
  type SynchronizedClockActivation,
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
type PluginCallback = (payload: {
  plugins: ManifestPlugin[];
  clockOffsetMs: number;
}) => void;

const store = new StateStore(process.env.TILECAST_DATA_DIR ?? defaultDataDir());
const presentCallbacks = new Set<PresentCallback>();
const syncPositionCallbacks = new Set<SyncPositionCallback>();
const pluginCallbacks = new Set<PluginCallback>();

let activeSynchronized: SynchronizedPlayingPresentation | null = null;
/**
 * Wall-clock and monotonic instants captured when the active synchronized
 * presentation was activated. Progression comes from the monotonic delta so a
 * clock correction mid-playback cannot rewind or fast-forward the timeline; the
 * wall-clock value is used only to place the initial position relative to the
 * server's playback anchor. Reactivating recaptures both.
 */
let synchronizedClock: SynchronizedClockActivation | null = null;
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

function synchronizedTimelineNowMs(): number {
  return synchronizedClock ? synchronizedNowMs(synchronizedClock) : Date.now();
}

function emitExpectedSynchronizedPosition(force: boolean): void {
  const presentation = activeSynchronized;
  if (!presentation) {
    return;
  }

  const position = synchronizedPlaybackPosition(
    presentation.synchronizedPlayback,
    synchronizedTimelineNowMs(),
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
  if (lastItemId !== null) {
    ipcRenderer.send("progress", { itemId: lastItemId, kind: "item-started" });
  }
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
    synchronizedClock = null;
    lastOccurrence = null;
    lastItemId = null;
    emitSyncPosition(null);
    emitPresentation(presentation);
    return;
  }

  activeSynchronized = presentation;
  // A fresh activation reads the wall clock once, so a late-joining player (or
  // one whose schedule/takeover anchor just changed) still lands at the right
  // point in the shared cycle.
  synchronizedClock = activateSynchronizedClock();
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
      synchronizedTimelineNowMs(),
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

ipcRenderer.on(
  "plugins",
  (_event, payload: { plugins: ManifestPlugin[]; clockOffsetMs: number }) => {
    for (const callback of pluginCallbacks) callback(payload);
  },
);

/** Minimal, typed bridge; the renderer has no Node access. */
contextBridge.exposeInMainWorld("tilecast", {
  onPresent(callback: PresentCallback): void {
    presentCallbacks.add(callback);
    if (lastPresentation !== null) {
      callback(lastPresentation);
    }
  },
  onPlugins(callback: PluginCallback): void {
    pluginCallbacks.add(callback);
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
  reportProgress(itemId: string | null, kind: string, zoneId?: string): void {
    ipcRenderer.send("progress", { itemId, kind, zoneId });
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
