import type { Screen, ScreenStatus } from "../api/types";
import type { ScreenPreview } from "../api/previews";

export type LivePreviewState =
  "loading" | "live" | "offline" | "stale" | "unavailable" | "capture-error";

const offlineStatuses = new Set<ScreenStatus>([
  "offline",
  "disabled",
  "revoked",
]);

export function livePreviewState(
  screen: Screen | undefined,
  preview: ScreenPreview | undefined,
  now = Date.now(),
): LivePreviewState {
  if (!screen || !preview) return "loading";
  if (offlineStatuses.has(screen.status)) return "offline";
  if (preview.status === "capture_error") return "capture-error";
  if (preview.status === "unavailable") return "unavailable";
  if (!preview.imageAvailable || !preview.capturedAt) return "loading";
  const captureAge = now - new Date(preview.capturedAt).getTime();
  if (
    screen.status === "stale" ||
    !Number.isFinite(captureAge) ||
    captureAge > 45_000
  )
    return "stale";
  return "live";
}

export function previewUnavailableMessage(failureStatus?: string) {
  if (failureStatus?.startsWith("sensitive_"))
    return "Preview is paused while a protected player screen is open.";
  return "A preview is not available from this player yet.";
}
