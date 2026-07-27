/**
 * Holds the on-screen video on the group's shared timeline.
 *
 * The correction policy lives in `playback-policy.ts` (loaded first, as a plain
 * global script). This file is only the DOM half: find the video that the
 * shared position actually refers to, measure it, apply the decision.
 */
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
  // Correction state belongs to the element, not to the occurrence: a new
  // occurrence is normally the same shared timeline continuing, and a new
  // element starts with a clean slate.
  let trackedVideo: HTMLVideoElement | null = null;
  let syncState = newVideoSyncState();

  bridge.onSyncPosition((position) => {
    if (!position || position.kind !== "video") {
      return;
    }

    const visibleLayer = document.querySelector(".layer.visible");
    const video = visibleLayer?.querySelector(
      "video",
    ) as HTMLVideoElement | null;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }
    // The previous item remains visible during the crossfade. It must never
    // receive the next item's synchronized timeline position.
    if (video.dataset.tilecastItemId !== position.itemId || video.seeking) {
      return;
    }
    if (video !== trackedVideo) {
      trackedVideo = video;
      syncState = newVideoSyncState();
    }

    const nowMs = performance.now();
    const correction = videoSyncCorrection({
      expectedMs: position.videoStartOffsetMs + position.offsetMs,
      actualMs: video.currentTime * 1_000,
      nowMs,
      state: syncState,
    });

    video.playbackRate = correction.playbackRate;
    if (correction.action !== "seek" || correction.seekToMs === null) {
      return;
    }
    try {
      video.currentTime = correction.seekToMs / 1_000;
      recordVideoSyncSeek(syncState, nowMs);
    } catch {
      // Metadata may still be settling; the next 250 ms correction retries.
    }
  });
})();
