import { describe, expect, it } from "vitest";
import type { PlaylistItem } from "../api/types";
import {
  createPrimitivePlacement,
  nextPlaylistPreviewIndex,
  playlistPreviewDuration,
} from "./LayoutEditorPage";

const canvas = {
  width: 1920,
  height: 1080,
  orientation: "landscape" as const,
  backgroundColor: "#101820",
  safeAreaPercent: 5,
};

describe("Layout editor primitives", () => {
  it("creates renderer-neutral text placements with safe bundled defaults", () => {
    const placement = createPrimitivePlacement("text", canvas);
    expect(placement.type).toBe("primitive");
    expect(placement.primitive?.kind).toBe("text");
    expect(placement.primitive?.fontFamily).toBe("Inter");
    expect(placement.widgetId).toBeUndefined();
    expect(placement.x + placement.width).toBeLessThanOrEqual(canvas.width);
  });

  it("creates line and group geometry inside the canvas", () => {
    const line = createPrimitivePlacement("line", canvas);
    const group = createPrimitivePlacement("group", canvas);
    expect(line.height).toBe(8);
    expect(group.primitive?.kind).toBe("group");
    expect(group.y + group.height).toBeLessThanOrEqual(canvas.height);
  });
});

describe("Layout playlist previews", () => {
  const item = {
    durationMs: 7_500,
    assetType: "image",
  } as PlaylistItem;

  it("uses configured item timing and a bounded fallback for static content", () => {
    expect(playlistPreviewDuration(item)).toBe(7_500);
    expect(playlistPreviewDuration({ ...item, durationMs: undefined })).toBe(
      10_000,
    );
    expect(
      playlistPreviewDuration({
        ...item,
        durationMs: undefined,
        assetType: "video",
      }),
    ).toBeUndefined();
  });

  it("advances independent zones while honoring the loop setting", () => {
    expect(nextPlaylistPreviewIndex(0, 3, true)).toBe(1);
    expect(nextPlaylistPreviewIndex(2, 3, true)).toBe(0);
    expect(nextPlaylistPreviewIndex(2, 3, false)).toBe(2);
  });
});
