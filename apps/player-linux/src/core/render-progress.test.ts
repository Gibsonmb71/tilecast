import { describe, expect, it } from "vitest";
import {
  assessRenderProgress,
  DEFAULT_RENDER_PROGRESS_CONFIG,
  initialRenderProgressState,
  onItemPresented,
  onPlaybackIdle,
  onRenderProgress,
  recordAssessment,
  type PresentedItem,
  type RenderProgressState,
} from "./render-progress";

const T0 = 1_000_000;
const minute = 60_000;

function present(item: PresentedItem, at = T0): RenderProgressState {
  return onItemPresented(initialRenderProgressState(at), at, item);
}

describe("still images", () => {
  it("does not call a valid long-lived still image frozen", () => {
    // The case this module exists to protect. Ten minutes of identical pixels
    // is exactly what a fifteen-minute still is supposed to look like.
    let state = present({
      itemId: "poster",
      expectation: "still",
      expectedDurationMs: 15 * minute,
    });
    state = onRenderProgress(state, T0, {
      signal: "image_displayed",
      itemId: "poster",
    });

    const assessment = assessRenderProgress(state, T0 + 10 * minute);
    expect(assessment.progressing).toBe(true);
    expect(assessment.stallReason).toBeNull();
    expect(assessment.stallDurationMs).toBe(0);
    // And nothing about it was expected to move.
    expect(assessment.expectedMotion).toBe(false);
  });

  it("flags a still image that outstays the duration it was given", () => {
    let state = present({
      itemId: "poster",
      expectation: "still",
      expectedDurationMs: 5 * minute,
    });
    state = onRenderProgress(state, T0, {
      signal: "image_displayed",
      itemId: "poster",
    });

    const assessment = assessRenderProgress(state, T0 + 7 * minute);
    expect(assessment.progressing).toBe(false);
    expect(assessment.stallReason).toBe("item_overran_expected_duration");
  });

  it("does not accept a frame change as evidence for a still image", () => {
    let state = present({
      itemId: "poster",
      expectation: "still",
      expectedDurationMs: 5 * minute,
    });
    state = onRenderProgress(state, T0, {
      signal: "image_displayed",
      itemId: "poster",
    });
    const before = state.lastMeaningfulProgressAtMs;

    // Pixels changing under a still image is noise, not playback progress;
    // accepting it would let compression artefacts mask a real overrun.
    state = onRenderProgress(state, T0 + minute, {
      signal: "frame_fingerprint_changed",
      itemId: "poster",
    });
    expect(state.lastMeaningfulProgressAtMs).toBe(before);
  });

  it("gives an unbounded still a long but finite grace", () => {
    let state = present({ itemId: "poster", expectation: "still" });
    state = onRenderProgress(state, T0, {
      signal: "image_displayed",
      itemId: "poster",
    });

    expect(assessRenderProgress(state, T0 + 20 * minute).progressing).toBe(
      true,
    );
    expect(assessRenderProgress(state, T0 + 45 * minute).stallReason).toBe(
      "item_overran_expected_duration",
    );
  });
});

describe("video", () => {
  it("requires the playback position to advance", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onRenderProgress(state, T0, {
      signal: "video_position_advanced",
      itemId: "clip",
    });

    expect(assessRenderProgress(state, T0 + 10_000).progressing).toBe(true);
    const stalled = assessRenderProgress(state, T0 + 40_000);
    expect(stalled.progressing).toBe(false);
    expect(stalled.stallReason).toBe("video_position_frozen");
    expect(stalled.expectedMotion).toBe(true);
  });

  it("measures the stall from the last progress, not from when it was noticed", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onRenderProgress(state, T0, {
      signal: "video_position_advanced",
      itemId: "clip",
    });

    const assessment = assessRenderProgress(state, T0 + 5 * minute);
    // The screen has been wrong for five minutes, whatever the poll interval.
    expect(assessment.stallStartedAt).toBe(T0);
    expect(assessment.stallDurationMs).toBe(5 * minute);
  });
});

describe("websites", () => {
  it("waits for a first meaningful render, then stops demanding motion", () => {
    const state = present({ itemId: "dashboard", expectation: "website" });

    expect(assessRenderProgress(state, T0 + 30_000).progressing).toBe(true);
    expect(assessRenderProgress(state, T0 + 3 * minute).stallReason).toBe(
      "website_never_rendered",
    );

    const rendered = onRenderProgress(state, T0 + 30_000, {
      signal: "website_first_render",
      itemId: "dashboard",
    });
    // A static dashboard that rendered once is fine indefinitely.
    expect(assessRenderProgress(rendered, T0 + 60 * minute).progressing).toBe(
      true,
    );
  });
});

describe("layouts", () => {
  it("waits for every zone to supply its first render evidence", () => {
    let state = present({
      itemId: "layout-1",
      expectation: "layout",
      zoneIds: ["left", "right"],
    });
    state = onRenderProgress(state, T0 + 1_000, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "left",
    });

    // One zone has never rendered, so part of the screen is simply blank.
    expect(state.pendingZoneIds).toEqual(["right"]);
    expect(assessRenderProgress(state, T0 + 10 * minute).stallReason).toBe(
      "layout_zones_silent",
    );

    state = onRenderProgress(state, T0 + 2_000, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "right",
    });
    expect(assessRenderProgress(state, T0 + 10 * minute).progressing).toBe(
      true,
    );
  });

  it("does not demand continuing evidence from a static zone", () => {
    // A widget or image zone renders once and holds, exactly like a still
    // image. Holding it to a rotation cadence would flag a healthy layout.
    let state = present({
      itemId: "layout-1",
      expectation: "layout",
      zoneIds: ["static"],
      recurringZoneIds: [],
    });
    state = onRenderProgress(state, T0 + 1_000, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "static",
    });

    expect(assessRenderProgress(state, T0 + 60 * minute).progressing).toBe(
      true,
    );
  });

  it("catches a rotating zone that rendered once and then died", () => {
    // The case per-zone tracking exists for: the other zones keep the layout
    // looking alive, so a whole-layout signal would hide this completely.
    let state = present({
      itemId: "layout-1",
      expectation: "layout",
      zoneIds: ["static", "rotating"],
      recurringZoneIds: ["rotating"],
    });
    for (const zoneId of ["static", "rotating"]) {
      state = onRenderProgress(state, T0 + 1_000, {
        signal: "layout_child_rendered",
        itemId: "layout-1",
        zoneId,
      });
    }
    expect(state.pendingZoneIds).toEqual([]);

    // The static zone keeps holding, which is fine. The rotating one has not
    // advanced in ten minutes, which is not.
    expect(assessRenderProgress(state, T0 + 3 * minute).progressing).toBe(true);
    expect(assessRenderProgress(state, T0 + 10 * minute).stallReason).toBe(
      "layout_zones_silent",
    );
  });

  it("clears once the rotating zone advances again", () => {
    let state = present({
      itemId: "layout-1",
      expectation: "layout",
      zoneIds: ["rotating"],
      recurringZoneIds: ["rotating"],
    });
    state = onRenderProgress(state, T0 + 1_000, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "rotating",
    });
    expect(assessRenderProgress(state, T0 + 10 * minute).progressing).toBe(
      false,
    );

    state = onRenderProgress(state, T0 + 10 * minute, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "rotating",
    });
    expect(assessRenderProgress(state, T0 + 11 * minute).progressing).toBe(
      true,
    );
  });

  it("tracks each zone independently", () => {
    let state = present({
      itemId: "layout-1",
      expectation: "layout",
      zoneIds: ["left", "right"],
      recurringZoneIds: ["left", "right"],
    });
    state = onRenderProgress(state, T0, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "left",
    });
    state = onRenderProgress(state, T0, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "right",
    });
    // Only the left zone keeps advancing; the right one going quiet must
    // still be caught even though the layout is producing signals.
    state = onRenderProgress(state, T0 + 8 * minute, {
      signal: "layout_child_rendered",
      itemId: "layout-1",
      zoneId: "left",
    });

    expect(assessRenderProgress(state, T0 + 8 * minute).stallReason).toBe(
      "layout_zones_silent",
    );
    expect(state.zoneProgressAtMs["left"]).toBe(T0 + 8 * minute);
    expect(state.zoneProgressAtMs["right"]).toBe(T0);
  });
});

describe("indefinite content", () => {
  it("accepts a renderer health confirmation as progress", () => {
    let state = present({ itemId: "stream", expectation: "indefinite" });

    expect(assessRenderProgress(state, T0 + 20 * minute).progressing).toBe(
      false,
    );
    state = onRenderProgress(state, T0 + 20 * minute, {
      signal: "renderer_health_confirmed",
    });
    expect(assessRenderProgress(state, T0 + 25 * minute).progressing).toBe(
      true,
    );
  });

  it("does not accept a health confirmation as progress for other content", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onRenderProgress(state, T0, {
      signal: "video_position_advanced",
      itemId: "clip",
    });
    state = onRenderProgress(state, T0 + 40_000, {
      signal: "renderer_health_confirmed",
    });

    // The renderer answering is not the video advancing. Treating it as
    // progress is precisely how a player reports health over a frozen screen.
    const assessment = assessRenderProgress(state, T0 + 45_000);
    expect(assessment.progressing).toBe(false);
    expect(assessment.stallReason).toBe("video_position_frozen");
    expect(assessment.rendererResponding).toBe(true);
  });
});

describe("the three states a player can be in", () => {
  it("separates renderer liveness from playback progress", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onRenderProgress(state, T0, {
      signal: "renderer_health_confirmed",
    });

    const assessment = assessRenderProgress(state, T0 + minute);
    // Process alive and renderer alive, but playback is not progressing.
    expect(assessment.rendererResponding).toBe(true);
    expect(assessment.progressing).toBe(false);
  });

  it("names the content stall, not the renderer, when the content is the evidence", () => {
    const state = present({ itemId: "clip", expectation: "video" });
    const assessment = assessRenderProgress(
      state,
      T0 + DEFAULT_RENDER_PROGRESS_CONFIG.rendererHealthToleranceMs + minute,
    );
    // A frozen video is a frozen video. Blaming the renderer would assert a
    // cause the player has no evidence for.
    expect(assessment.stallReason).toBe("video_position_frozen");
    expect(assessment.rendererResponding).toBe(false);
  });

  it("blames the renderer only where a probe is the only evidence", () => {
    const state = present({ itemId: "stream", expectation: "indefinite" });
    const assessment = assessRenderProgress(
      state,
      T0 + DEFAULT_RENDER_PROGRESS_CONFIG.rendererHealthToleranceMs + minute,
    );
    expect(assessment.stallReason).toBe("renderer_not_responding");
    expect(assessment.rendererResponding).toBe(false);
  });
});

describe("state bookkeeping", () => {
  it("ignores a late signal from the item that just left the screen", () => {
    let state = present({ itemId: "first", expectation: "video" });
    state = onItemPresented(state, T0 + minute, {
      itemId: "second",
      expectation: "video",
    });
    const before = state.lastMeaningfulProgressAtMs;

    state = onRenderProgress(state, T0 + 2 * minute, {
      signal: "video_position_advanced",
      itemId: "first",
    });
    expect(state.lastMeaningfulProgressAtMs).toBe(before);
  });

  it("gives a new item a fresh window rather than inheriting a stall", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = recordAssessment(
      state,
      assessRenderProgress(state, T0 + 5 * minute),
    );
    expect(state.stallStartedAtMs).not.toBeNull();

    state = onItemPresented(state, T0 + 5 * minute, {
      itemId: "next",
      expectation: "video",
    });
    expect(state.stallStartedAtMs).toBeNull();
    expect(
      assessRenderProgress(state, T0 + 5 * minute + 1_000).progressing,
    ).toBe(true);
  });

  it("treats an idle screen as having nothing to progress", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onPlaybackIdle(state, T0 + minute);

    // Off hours is not a stall; there is nothing that should be playing.
    const assessment = assessRenderProgress(state, T0 + 60 * minute);
    expect(assessment.progressing).toBe(true);
    expect(assessment.stallReason).toBeNull();
  });

  it("keeps the stall start stable while the stall continues", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = onRenderProgress(state, T0, {
      signal: "video_position_advanced",
      itemId: "clip",
    });

    state = recordAssessment(state, assessRenderProgress(state, T0 + minute));
    const first = state.stallStartedAtMs;
    state = recordAssessment(
      state,
      assessRenderProgress(state, T0 + 3 * minute),
    );
    expect(state.stallStartedAtMs).toBe(first);
    expect(assessRenderProgress(state, T0 + 3 * minute).stallDurationMs).toBe(
      3 * minute,
    );
  });

  it("clears the stall when real progress resumes", () => {
    let state = present({ itemId: "clip", expectation: "video" });
    state = recordAssessment(
      state,
      assessRenderProgress(state, T0 + 5 * minute),
    );
    state = onRenderProgress(state, T0 + 5 * minute, {
      signal: "video_position_advanced",
      itemId: "clip",
    });

    expect(state.stallStartedAtMs).toBeNull();
    expect(assessRenderProgress(state, T0 + 5 * minute).stallReason).toBeNull();
  });
});
