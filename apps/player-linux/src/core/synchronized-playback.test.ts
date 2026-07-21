import { describe, expect, it } from "vitest";
import type { StoredManifest } from "./manifest";
import type { Presentation, PresentationItem } from "./player";
import {
  effectiveDurationMs,
  enrichSynchronizedPresentation,
  projectSynchronizedPresentation,
  schedulePlaybackAnchorMs,
  synchronizedPlaybackPosition,
  type SynchronizedPlayingPresentation,
} from "./synchronized-playback";
import type { Manifest, ManifestItem, ManifestSchedule } from "./types";

const image = (id: string, durationMs: number): PresentationItem => ({
  id,
  kind: "image",
  src: `tcmedia://variant/${id}/v-${id}`,
  durationMs,
  fitMode: "contain",
  audioEnabled: false,
  volume: 0,
  videoStartOffsetMs: null,
  videoEndOffsetMs: null,
});

const video = (id: string): PresentationItem => ({
  id,
  kind: "video",
  src: `tcmedia://variant/${id}/v-${id}`,
  durationMs: null,
  fitMode: "contain",
  audioEnabled: true,
  volume: 1,
  videoStartOffsetMs: 2_000,
  videoEndOffsetMs: 22_000,
});

function manifest(epoch: string): Manifest {
  const items: ManifestItem[] = [
    {
      id: "image-1",
      assetId: "image-asset",
      variantId: "v-image-1",
      assetType: "image",
      durationMs: 10_000,
      fitMode: "contain",
      transition: "none",
      audioEnabled: false,
      volume: 0,
      deliveryPolicy: "download",
    },
    {
      id: "video-1",
      assetId: "video-asset",
      variantId: "v-video-1",
      assetType: "video",
      fitMode: "contain",
      transition: "none",
      audioEnabled: true,
      volume: 1,
      videoStartOffsetMs: 2_000,
      videoEndOffsetMs: 22_000,
      deliveryPolicy: "download",
    },
  ];
  const playlist = { id: "playlist-1", revision: 1, name: "Group", items };
  return {
    schemaVersion: 14,
    manifestVersion: 1,
    screenId: "screen-1",
    generatedAt: epoch,
    mode: "single-zone",
    playlist,
    directFallbackPlaylist: null,
    playlists: [playlist],
    schedules: [],
    assets: [
      {
        assetId: "image-asset",
        variantId: "v-image-1",
        mimeType: "image/png",
        sha256: "a",
        fileSize: 1,
        downloadPath: "/image",
      },
      {
        assetId: "video-asset",
        variantId: "v-video-1",
        mimeType: "video/mp4",
        sha256: "b",
        fileSize: 1,
        durationSeconds: 24,
        downloadPath: "/video",
      },
    ],
    serverTime: epoch,
    prefetchHorizonDays: 7,
    activationGraceSeconds: 0,
    websites: [],
    emergency: null,
    syncGroup: { id: "group-1", playbackEpoch: epoch },
  };
}

describe("synchronizedPlaybackPosition", () => {
  it("selects the shared item and in-item offset", () => {
    const position = synchronizedPlaybackPosition(
      { groupId: "group-1", anchorMs: 1_000, durationsMs: [10_000, 20_000] },
      16_000,
    );
    expect(position).toEqual({
      index: 1,
      offsetMs: 5_000,
      remainingMs: 15_000,
      occurrence: 1,
    });
  });

  it("increments occurrences for single-item playlists", () => {
    const position = synchronizedPlaybackPosition(
      { groupId: "group-1", anchorMs: 0, durationsMs: [10_000] },
      25_000,
    );
    expect(position).toMatchObject({
      index: 0,
      offsetMs: 5_000,
      occurrence: 2,
    });
  });
});

describe("projectSynchronizedPresentation", () => {
  it("rotates to the expected item and seeks into video", () => {
    const base = {
      state: "playing",
      items: [image("image-1", 10_000), video("video-1")],
      emergency: false,
      generation: 2,
      synchronizedPlayback: {
        groupId: "group-1",
        anchorMs: 0,
        durationsMs: [10_000, 20_000],
      },
    } satisfies SynchronizedPlayingPresentation;
    const projected = projectSynchronizedPresentation(
      base,
      { index: 1, offsetMs: 5_000, remainingMs: 15_000, occurrence: 1 },
      99,
    );
    expect(projected.generation).toBe(99);
    expect(projected.items.map((item) => item.id)).toEqual([
      "video-1",
      "image-1",
    ]);
    expect(projected.items[0]).toMatchObject({
      durationMs: 15_000,
      videoStartOffsetMs: 7_000,
    });
  });
});

describe("enrichSynchronizedPresentation", () => {
  it("uses the group epoch and Android-compatible effective durations", () => {
    const epoch = "2026-07-20T12:00:00Z";
    const stored: StoredManifest = {
      manifest: manifest(epoch),
      etag: null,
      storedAt: epoch,
    };
    const presentation: Presentation = {
      state: "playing",
      items: [image("image-1", 10_000), video("video-1")],
      emergency: false,
      generation: 1,
    };
    const enriched = enrichSynchronizedPresentation(
      presentation,
      stored,
      Date.parse(epoch) + 15_000,
    ) as SynchronizedPlayingPresentation;
    expect(enriched.synchronizedPlayback).toEqual({
      groupId: "group-1",
      anchorMs: Date.parse(epoch),
      durationsMs: [10_000, 20_000],
    });
  });

  it("does not synchronize ungrouped playback", () => {
    const epoch = "2026-07-20T12:00:00Z";
    const ungrouped = manifest(epoch);
    ungrouped.syncGroup = null;
    const presentation: Presentation = {
      state: "playing",
      items: [image("image-1", 10_000)],
      emergency: false,
      generation: 1,
    };
    expect(
      enrichSynchronizedPresentation(presentation, {
        manifest: ungrouped,
        etag: null,
        storedAt: epoch,
      }),
    ).toBe(presentation);
  });
});

describe("schedulePlaybackAnchorMs", () => {
  it("anchors a weekly schedule at the active local window start", () => {
    const schedule: ManifestSchedule = {
      id: "schedule-1",
      playlistId: "playlist-1",
      layoutId: null,
      type: "weekly",
      timezone: "America/New_York",
      priority: 1,
      specificity: 1,
      dailyStart: "07:00",
      dailyEnd: "19:00",
      daysOfWeek: [1],
    };
    expect(
      schedulePlaybackAnchorMs(schedule, Date.parse("2026-07-20T16:00:00Z")),
    ).toBe(Date.parse("2026-07-20T11:00:00Z"));
  });
});

describe("effectiveDurationMs", () => {
  it("derives clipped video duration when no explicit duration exists", () => {
    expect(
      effectiveDurationMs(
        video("video-1"),
        {
          id: "video-1",
          assetId: "video-asset",
          variantId: "v-video-1",
          assetType: "video",
          fitMode: "contain",
          transition: "none",
          audioEnabled: true,
          volume: 1,
          videoStartOffsetMs: 2_000,
          videoEndOffsetMs: 22_000,
          deliveryPolicy: "download",
        },
        undefined,
      ),
    ).toBe(20_000);
  });
});
