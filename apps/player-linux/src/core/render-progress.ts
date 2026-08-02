/**
 * Meaningful render-progress detection.
 *
 * Three things are routinely confused, and conflating them is what makes a
 * player report itself healthy while the screen is blank:
 *
 *   1. the process is alive — it answers heartbeats;
 *   2. the renderer object is alive — a view exists;
 *   3. playback is actually progressing — something is happening on screen.
 *
 * Only the third is health. This module tracks it from real signals and, just
 * as importantly, knows when *no* signal is expected: a still image scheduled
 * to sit on screen for ten minutes is doing exactly its job, and calling it
 * frozen because the pixels have not changed would be wrong.
 *
 * Expectations are therefore content-aware. Decisions are pure functions of
 * (state, now) so the policy is unit-testable; the caller owns timers.
 */

/** What kind of content is on screen, which decides what progress looks like. */
export type ContentExpectation =
  /** A still image: displayed successfully, then legitimately motionless. */
  | "still"
  /** Video: the playback position must advance. */
  | "video"
  /** A website: a first meaningful render, then optional frame changes. */
  | "website"
  /** A layout: each zone must supply its own render evidence. */
  | "layout"
  /** Indefinite content with no natural boundary; only renderer health. */
  | "indefinite"
  /** Nothing is playing, so there is nothing to progress. */
  | "none";

/** The signals that constitute real progress, in the player's own terms. */
export type ProgressSignal =
  | "video_position_advanced"
  | "item_transition"
  | "image_displayed"
  | "website_first_render"
  | "layout_child_rendered"
  | "frame_fingerprint_changed"
  | "renderer_health_confirmed";

export type StallReason =
  | "video_position_frozen"
  | "item_overran_expected_duration"
  | "website_never_rendered"
  | "layout_zones_silent"
  | "renderer_not_responding"
  | "frame_frozen_while_motion_expected";

export interface RenderProgressConfig {
  /** Video must advance at least this often, allowing for buffering. */
  videoProgressToleranceMs: number;
  /** How far past its expected duration an item may run before it is stalled. */
  itemOverrunToleranceMs: number;
  /** A website must complete its first render within this long. */
  websiteFirstRenderTimeoutMs: number;
  /** Every zone must produce evidence at least this often. */
  layoutZoneToleranceMs: number;
  /**
   * Indefinite content only has to prove the renderer still answers. Generous,
   * because there is nothing else to measure.
   */
  rendererHealthToleranceMs: number;
  /**
   * A still image with no known duration is given this long before its lack of
   * change becomes suspicious. Deliberately long: a valid still is the case
   * this whole module exists to protect.
   */
  stillWithoutDurationToleranceMs: number;
}

export const DEFAULT_RENDER_PROGRESS_CONFIG: RenderProgressConfig = {
  videoProgressToleranceMs: 20_000,
  itemOverrunToleranceMs: 60_000,
  websiteFirstRenderTimeoutMs: 90_000,
  layoutZoneToleranceMs: 5 * 60_000,
  rendererHealthToleranceMs: 10 * 60_000,
  stillWithoutDurationToleranceMs: 30 * 60_000,
};

/**
 * Resolve the renderer policy from the server-owned player configuration.
 *
 * The other render-progress tolerances are renderer invariants, but the
 * amount of time a website may take to produce its first meaningful render is
 * an administrator policy. Keeping this conversion here makes every caller
 * use the same units and preserves the safe default for older cached configs.
 */
export function renderProgressConfigFor(
  reliability: Record<string, unknown> | undefined,
): RenderProgressConfig {
  const configuredSeconds = Number(reliability?.webviewStallSeconds);
  const websiteFirstRenderTimeoutMs =
    Number.isFinite(configuredSeconds) && configuredSeconds >= 1
      ? configuredSeconds * 1_000
      : DEFAULT_RENDER_PROGRESS_CONFIG.websiteFirstRenderTimeoutMs;
  return {
    ...DEFAULT_RENDER_PROGRESS_CONFIG,
    websiteFirstRenderTimeoutMs,
  };
}

export interface RenderProgressState {
  expectation: ContentExpectation;
  /** The item on screen, so a signal for a stale item is ignored. */
  itemId: string | null;
  itemStartedAtMs: number | null;
  /** The item's own duration, when it has one. */
  expectedDurationMs: number | null;
  /** Zones still owed their first render evidence for the current layout. */
  pendingZoneIds: string[];
  /**
   * Zones that must keep producing evidence. A static widget zone renders once
   * and legitimately stops, exactly like a still image; only a rotating zone
   * can be judged on continuing evidence.
   */
  recurringZoneIds: string[];
  /** Last time each zone reported. */
  zoneProgressAtMs: Record<string, number>;

  lastMeaningfulProgressAtMs: number | null;
  lastSignal: ProgressSignal | null;
  /**
   * Whether the item has ever rendered. Presenting an item is progress, so
   * `lastSignal` cannot carry this: it is already set by the transition.
   */
  renderConfirmed: boolean;
  /** Set the moment a stall is first detected, and cleared by real progress. */
  stallStartedAtMs: number | null;
  stallReason: StallReason | null;
  /** The renderer answered a liveness probe. Not the same as progressing. */
  rendererRespondingAtMs: number | null;
}

export function initialRenderProgressState(nowMs: number): RenderProgressState {
  return {
    expectation: "none",
    itemId: null,
    itemStartedAtMs: null,
    expectedDurationMs: null,
    pendingZoneIds: [],
    recurringZoneIds: [],
    zoneProgressAtMs: {},
    lastMeaningfulProgressAtMs: nowMs,
    lastSignal: null,
    renderConfirmed: false,
    stallStartedAtMs: null,
    stallReason: null,
    rendererRespondingAtMs: nowMs,
  };
}

export interface PresentedItem {
  itemId: string;
  expectation: ContentExpectation;
  /** Known duration, when the item has one. */
  expectedDurationMs?: number | null;
  /** Every zone identifier, each of which owes a first render. */
  zoneIds?: string[];
  /**
   * The subset that must keep reporting — rotating playlist zones. A zone that
   * renders once and holds is not owed anything further.
   */
  recurringZoneIds?: string[];
}

/**
 * A new item is on screen. Presenting is itself progress: the player did
 * something, and the new item gets a fresh window to prove itself in rather
 * than inheriting the previous item's stall.
 */
export function onItemPresented(
  state: RenderProgressState,
  nowMs: number,
  item: PresentedItem,
): RenderProgressState {
  return {
    ...state,
    expectation: item.expectation,
    itemId: item.itemId,
    itemStartedAtMs: nowMs,
    expectedDurationMs: item.expectedDurationMs ?? null,
    pendingZoneIds: item.zoneIds ? [...item.zoneIds] : [],
    recurringZoneIds: item.recurringZoneIds ? [...item.recurringZoneIds] : [],
    zoneProgressAtMs: {},
    lastMeaningfulProgressAtMs: nowMs,
    lastSignal: "item_transition",
    renderConfirmed: false,
    stallStartedAtMs: null,
    stallReason: null,
  };
}

/** Nothing is on screen by design — off hours, disabled, or no content. */
export function onPlaybackIdle(
  state: RenderProgressState,
  nowMs: number,
): RenderProgressState {
  return {
    ...initialRenderProgressState(nowMs),
    rendererRespondingAtMs: state.rendererRespondingAtMs,
  };
}

export interface ProgressReport {
  signal: ProgressSignal;
  /** The item the signal is about; a signal for a stale item is ignored. */
  itemId?: string | null;
  /** For a layout child render. */
  zoneId?: string;
  /**
   * Whether the frame was expected to change. A fingerprint change on a still
   * image is not progress evidence — it is more likely noise or compression.
   */
  motionExpected?: boolean;
}

/** Record a progress signal. Signals for a superseded item are ignored. */
export function onRenderProgress(
  state: RenderProgressState,
  nowMs: number,
  report: ProgressReport,
): RenderProgressState {
  if (
    report.itemId != null &&
    state.itemId != null &&
    report.itemId !== state.itemId
  ) {
    // Late signal from the item that just left the screen.
    return state;
  }

  // A renderer health probe proves the renderer answers, which is weaker than
  // progress and is only accepted as progress for indefinite content.
  if (report.signal === "renderer_health_confirmed") {
    const next = { ...state, rendererRespondingAtMs: nowMs };
    if (state.expectation !== "indefinite") return next;
    return {
      ...next,
      lastMeaningfulProgressAtMs: nowMs,
      lastSignal: report.signal,
      stallStartedAtMs: null,
      stallReason: null,
    };
  }

  // A fingerprint change only counts where motion was expected in the first
  // place; on a still image it is noise, not evidence of playback.
  if (
    report.signal === "frame_fingerprint_changed" &&
    !(report.motionExpected ?? expectsMotion(state.expectation))
  ) {
    return state;
  }

  const zoneProgressAtMs = { ...state.zoneProgressAtMs };
  let pendingZoneIds = state.pendingZoneIds;
  if (report.signal === "layout_child_rendered" && report.zoneId) {
    zoneProgressAtMs[report.zoneId] = nowMs;
    pendingZoneIds = pendingZoneIds.filter((zone) => zone !== report.zoneId);
  }

  return {
    ...state,
    zoneProgressAtMs,
    pendingZoneIds,
    lastMeaningfulProgressAtMs: nowMs,
    lastSignal: report.signal,
    renderConfirmed: true,
    rendererRespondingAtMs: nowMs,
    stallStartedAtMs: null,
    stallReason: null,
  };
}

/** Whether the content on screen is supposed to be moving at all. */
export function expectsMotion(expectation: ContentExpectation): boolean {
  return expectation === "video";
}

export interface RenderProgressAssessment {
  lastMeaningfulProgressAt: number | null;
  stallStartedAt: number | null;
  stallDurationMs: number;
  stallReason: StallReason | null;
  expectedMotion: boolean;
  rendererResponding: boolean;
  /** Whether playback is progressing as this content is expected to. */
  progressing: boolean;
}

/**
 * Judge the current state. This is where content-awareness lives: each kind of
 * content gets the tolerance that fits it, so a valid still image is never
 * called frozen and a stalled video is caught quickly.
 */
export function assessRenderProgress(
  state: RenderProgressState,
  nowMs: number,
  config: RenderProgressConfig = DEFAULT_RENDER_PROGRESS_CONFIG,
): RenderProgressAssessment {
  const expectedMotion = expectsMotion(state.expectation);
  const reason = stallReasonFor(state, nowMs, config);
  // Silence is only evidence of a dead renderer where evidence was owed. A
  // still image that has been on screen for twenty minutes has said nothing
  // because nothing was asked of it, not because the renderer died.
  const rendererResponding =
    reason !== "renderer_not_responding" &&
    (reason === null ||
      state.rendererRespondingAtMs == null ||
      nowMs - state.rendererRespondingAtMs <= config.rendererHealthToleranceMs);
  const base = {
    lastMeaningfulProgressAt: state.lastMeaningfulProgressAtMs,
    expectedMotion,
    rendererResponding,
  };

  if (reason === null) {
    return {
      ...base,
      stallStartedAt: null,
      stallDurationMs: 0,
      stallReason: null,
      progressing: true,
    };
  }
  // The stall began when progress was last seen, not when it was noticed, so
  // the duration reflects how long the screen has actually been wrong.
  const startedAt =
    state.stallStartedAtMs ?? state.lastMeaningfulProgressAtMs ?? nowMs;
  return {
    ...base,
    stallStartedAt: startedAt,
    stallDurationMs: Math.max(0, nowMs - startedAt),
    stallReason: reason,
    progressing: false,
  };
}

function stallReasonFor(
  state: RenderProgressState,
  nowMs: number,
  config: RenderProgressConfig,
): StallReason | null {
  // Nothing is meant to be playing, so nothing can be stalled.
  if (state.expectation === "none") return null;

  const sinceProgress =
    state.lastMeaningfulProgressAtMs == null
      ? 0
      : nowMs - state.lastMeaningfulProgressAtMs;
  const sinceStart =
    state.itemStartedAtMs == null ? 0 : nowMs - state.itemStartedAtMs;

  switch (state.expectation) {
    case "video":
      // Video is the one case where silence is unambiguous: the position
      // should be advancing, so a gap means it is not.
      return sinceProgress > config.videoProgressToleranceMs
        ? "video_position_frozen"
        : null;

    case "website":
      if (!state.renderConfirmed) {
        return sinceStart > config.websiteFirstRenderTimeoutMs
          ? "website_never_rendered"
          : null;
      }
      // Rendered once. Frame changes are optional after that, so a static
      // dashboard is healthy indefinitely.
      return null;

    case "layout": {
      // A zone that has never rendered is the clearest failure: part of the
      // screen is simply blank.
      if (
        state.pendingZoneIds.length > 0 &&
        sinceStart > config.layoutZoneToleranceMs
      ) {
        return "layout_zones_silent";
      }
      // A rotating zone that rendered once and then went quiet is a stall the
      // layout as a whole would otherwise hide, because its other zones keep
      // the presentation looking alive.
      for (const zoneId of state.recurringZoneIds) {
        const lastAt = state.zoneProgressAtMs[zoneId];
        if (lastAt == null) continue;
        if (nowMs - lastAt > config.layoutZoneToleranceMs) {
          return "layout_zones_silent";
        }
      }
      return null;
    }

    case "still":
      // The case this module exists to protect: a still image that has been
      // displayed is doing its job, however long the pixels stay identical.
      // It is only suspicious once it outstays the duration it was given.
      if (state.expectedDurationMs != null) {
        return sinceStart >
          state.expectedDurationMs + config.itemOverrunToleranceMs
          ? "item_overran_expected_duration"
          : null;
      }
      if (!state.renderConfirmed) {
        // Never confirmed as displayed at all, which is a different problem
        // from a still that displayed and then sat there.
        return sinceStart > config.websiteFirstRenderTimeoutMs
          ? "website_never_rendered"
          : null;
      }
      return sinceStart > config.stillWithoutDurationToleranceMs
        ? "item_overran_expected_duration"
        : null;

    case "indefinite":
      return sinceProgress > config.rendererHealthToleranceMs
        ? "renderer_not_responding"
        : null;

    default:
      return null;
  }
}

/**
 * Folds the assessment back into the state so the stall start is remembered
 * across evaluations rather than recomputed from scratch each time.
 */
export function recordAssessment(
  state: RenderProgressState,
  assessment: RenderProgressAssessment,
): RenderProgressState {
  if (assessment.progressing) {
    if (state.stallStartedAtMs === null) return state;
    return { ...state, stallStartedAtMs: null, stallReason: null };
  }
  return {
    ...state,
    stallStartedAtMs: assessment.stallStartedAt,
    stallReason: assessment.stallReason,
  };
}
