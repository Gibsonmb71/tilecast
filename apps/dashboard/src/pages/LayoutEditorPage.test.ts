import { describe, expect, it } from "vitest";
import type {
  Asset,
  LayoutDocument,
  Playlist,
  PlaylistItem,
} from "../api/types";
import {
  createPrimitivePlacement,
  flushLatestLayoutDraft,
  nextPlaylistPreviewIndex,
  playlistPreviewDuration,
  recentLayoutLibraryItems,
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

describe("Layout recent content library", () => {
  const assets = [
    {
      id: "widget",
      name: "Weather",
      type: "widget",
      createdAt: "2026-07-16T12:00:00Z",
    },
    {
      id: "image",
      name: "Poster",
      type: "image",
      createdAt: "2026-07-16T13:00:00Z",
    },
  ] as Asset[];
  const playlists = [
    {
      id: "playlist",
      name: "Lobby",
      createdAt: "2026-07-16T14:00:00Z",
    },
  ] as Playlist[];

  it("filters by the selected content type", () => {
    expect(recentLayoutLibraryItems("widgets", assets, playlists)).toHaveLength(
      1,
    );
    expect(recentLayoutLibraryItems("media", assets, playlists)[0]?.kind).toBe(
      "asset",
    );
    expect(
      recentLayoutLibraryItems("playlists", assets, playlists)[0]?.kind,
    ).toBe("playlist");
  });
});

describe("Layout autosave", () => {
  it("queues edits made while an earlier draft is saving", async () => {
    let changeVersion = 1;
    let savedChangeVersion = 0;
    let revision = 4;
    let document: LayoutDocument = {
      schemaVersion: 2,
      canvas,
      placements: [],
    };
    const persistedVersions: number[] = [];

    await flushLatestLayoutDraft(
      () => ({ changeVersion, savedChangeVersion, revision, document }),
      (expectedRevision) => {
        persistedVersions.push(changeVersion);
        if (persistedVersions.length === 1) {
          changeVersion = 2;
          document = {
            ...document,
            canvas: { ...canvas, backgroundColor: "#223344" },
          };
        }
        return Promise.resolve({ draftRevision: expectedRevision + 1 });
      },
      (version, draftRevision) => {
        savedChangeVersion = version;
        revision = draftRevision;
      },
    );

    expect(persistedVersions).toEqual([1, 2]);
    expect(savedChangeVersion).toBe(2);
    expect(revision).toBe(6);
  });
});
