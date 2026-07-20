(() => {
  interface SyncPositionEvent {
    itemId: string;
    kind: string;
    offsetMs: number;
    occurrence: number;
    videoStartOffsetMs: number;
  }

  interface SyncBridge {
    onSyncPosition(
      callback: (position: SyncPositionEvent | null) => void,
    ): void;
  }

  const bridge = (window as unknown as { tilecast: SyncBridge }).tilecast;
  let lastOccurrence = -1;

  bridge.onSyncPosition((position) => {
    if (!position || position.kind !== "video") {
      lastOccurrence = -1;
      return;
    }

    const visibleLayer = document.querySelector(".layer.visible");
    const video = visibleLayer?.querySelector("video") as HTMLVideoElement | null;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    const expectedMs = position.videoStartOffsetMs + position.offsetMs;
    const actualMs = video.currentTime * 1_000;
    const driftMs = expectedMs - actualMs;
    const absoluteDrift = Math.abs(driftMs);

    if (position.occurrence !== lastOccurrence || absoluteDrift > 250) {
      video.playbackRate = 1;
      try {
        video.currentTime = Math.max(0, expectedMs / 1_000);
      } catch {
        // Metadata may still be settling; the next 250 ms correction retries.
      }
    } else if (absoluteDrift > 80) {
      video.playbackRate = driftMs > 0 ? 1.02 : 0.98;
    } else {
      video.playbackRate = 1;
    }

    lastOccurrence = position.occurrence;
  });
})();
