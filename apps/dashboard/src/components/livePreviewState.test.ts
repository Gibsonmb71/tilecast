import { describe, expect, it } from "vitest";
import type { Screen } from "../api/types";
import type { ScreenPreview } from "../api/previews";
import { livePreviewState } from "./livePreviewState";

const screen = { status: "online" } as Screen;
const preview = {
  status: "available",
  imageAvailable: true,
  capturedAt: "2026-07-13T20:00:00Z",
  updatedAt: "2026-07-13T20:00:00Z",
} as ScreenPreview;

describe("livePreviewState", () => {
  it("shows a recent image as live", () => {
    expect(
      livePreviewState(screen, preview, Date.parse("2026-07-13T20:00:20Z")),
    ).toBe("live");
  });

  it("marks old captures as stale", () => {
    expect(
      livePreviewState(screen, preview, Date.parse("2026-07-13T20:01:00Z")),
    ).toBe("stale");
  });

  it("prioritizes player connectivity and capture errors", () => {
    expect(livePreviewState({ ...screen, status: "offline" }, preview)).toBe(
      "offline",
    );
    expect(
      livePreviewState(screen, { ...preview, status: "capture_error" }),
    ).toBe("capture-error");
  });
});
