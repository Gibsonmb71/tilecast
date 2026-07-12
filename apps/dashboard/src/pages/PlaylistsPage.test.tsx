// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { PlaylistItem } from "../api/types";
import { canManagePlaylists, playlistDuration } from "./PlaylistsPage";

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
});
