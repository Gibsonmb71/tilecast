// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaylistItem } from "../api/types";
import {
  canManagePlaylists,
  openPlaylistPreview,
  playlistDuration,
} from "./PlaylistsPage";
import {
  nextPlaylistPreviewItem,
  playlistPreviewItemDuration,
} from "./PlaylistPreviewPage";

afterEach(() => vi.restoreAllMocks());

const item = (values: Partial<PlaylistItem>): PlaylistItem => ({
  id: "item",
  assetId: "asset",
  position: 0,
  fitMode: "contain",
  transition: "none",
  audioEnabled: true,
  volume: 1,
  deliveryPolicy: "download",
  assetName: "Media",
  assetType: "image",
  assetStatus: "ready",
  thumbnailUrl: "/thumbnail",
  ...values,
});
describe("playlist editor", () => {
  it("keeps viewers read-only", () => {
    expect(canManagePlaylists("owner")).toBe(true);
    expect(canManagePlaylists("administrator")).toBe(true);
    expect(canManagePlaylists("editor")).toBe(true);
    expect(canManagePlaylists("viewer")).toBe(false);
  });
  it("calculates known image and clipped-video duration", () => {
    expect(
      playlistDuration([
        item({ durationMs: 10_000 }),
        item({
          id: "video",
          assetType: "video",
          assetDurationSeconds: 20,
          videoStartOffsetMs: 5_000,
          videoEndOffsetMs: 12_000,
        }),
      ]),
    ).toBe(17_000);
  });
  it("reports an unknown total for video without trusted duration", () => {
    expect(
      playlistDuration([
        item({ assetType: "video", assetDurationSeconds: undefined }),
      ]),
    ).toBeNull();
  });

  it("treats an omitted item collection as an empty playlist", () => {
    expect(playlistDuration(undefined)).toBe(0);
  });

  it("includes Layout item durations", () => {
    expect(
      playlistDuration([
        item({
          assetId: "",
          layoutId: "layout",
          assetType: "layout",
          durationMs: 30_000,
        }),
        item({ id: "image", durationMs: 10_000 }),
      ]),
    ).toBe(40_000);
  });

  it("opens the playlist preview in a focused popup window", () => {
    const focus = vi.fn();
    const popup = { focus, opener: window } as unknown as Window;
    const open = vi.spyOn(window, "open").mockReturnValue(popup);

    expect(openPlaylistPreview("playlist 1")).toBe(popup);
    expect(open).toHaveBeenCalledWith(
      "/playlists/playlist%201/preview",
      "tilecast-playlist-preview-playlist 1",
      "popup=yes,width=1280,height=800,resizable=yes,scrollbars=no",
    );
    expect(popup.opener).toBeNull();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("loops popup preview navigation and uses bounded non-video durations", () => {
    expect(nextPlaylistPreviewItem(2, 3, 1)).toBe(0);
    expect(nextPlaylistPreviewItem(0, 3, -1)).toBe(2);
    expect(playlistPreviewItemDuration(item({ durationMs: 7_500 }))).toBe(
      7_500,
    );
    expect(playlistPreviewItemDuration(item({ assetType: "layout" }))).toBe(
      10_000,
    );
    expect(
      playlistPreviewItemDuration(item({ assetType: "video" })),
    ).toBeUndefined();
  });
});
