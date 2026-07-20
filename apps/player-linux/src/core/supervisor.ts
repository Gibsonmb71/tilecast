/**
 * Playback self-heal supervisor.
 *
 * Health is judged by real playback progress — an item transition, advancing
 * video time, or a re-rendered image — never by whether a renderer object
 * exists, because a renderer can survive while the screen is blank or frozen.
 *
 * When progress stops for long enough the supervisor walks an escalation
 * ladder: re-activate cached content locally, recreate the renderer view,
 * recreate the kiosk window, and finally relaunch the whole process. The
 * ladder position is persisted so a relaunched process knows it already
 * restarted during this outage and will not restart-loop. Repeated
 * exhaustion of the ladder enters safe mode, which keeps networking,
 * commands, and health reporting alive instead of looping forever.
 *
 * Decisions are pure functions of (state, now) so the policy is fully
 * unit-testable; the caller owns timers and side effects.
 */

export type HealAction =
  | "none"
  | "reactivate_content"
  | "recreate_renderer"
  | "recreate_window"
  | "restart_process"
  | "enter_safe_mode";

/** Ladder order; index is persisted as escalationStep. */
const LADDER: HealAction[] = [
  "reactivate_content",
  "recreate_renderer",
  "recreate_window",
  "restart_process",
];

export interface SupervisorConfig {
  /** No progress for this long marks playback stalled. Must comfortably
   * exceed the longest legitimate still-image dwell heartbeat interval. */
  stallThresholdMs: number;
  /** Minimum spacing between consecutive heal actions. Disruptive restarts
   * require several minutes without progress, so a long-lived still image is
   * never mistaken for a freeze. */
  actionSpacingMs: number;
  /** Sustained progress required before failure history clears. */
  healthyClearMs: number;
  /** Full-ladder exhaustions within the window before safe mode. */
  maxLadderRunsBeforeSafeMode: number;
  /** Window for counting ladder exhaustions. */
  ladderRunWindowMs: number;
}

export const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  stallThresholdMs: 3 * 60_000,
  actionSpacingMs: 90_000,
  healthyClearMs: 10 * 60_000,
  maxLadderRunsBeforeSafeMode: 3,
  ladderRunWindowMs: 60 * 60_000,
};

/** Persisted across process restarts. */
export interface SupervisorState {
  lastProgressAtMs: number;
  /** Progress must persist this long before the streak clears. */
  healthySinceMs: number | null;
  escalationStep: number;
  lastActionAtMs: number | null;
  /** Timestamps of completed full-ladder runs, pruned to the window. */
  ladderRunsAtMs: number[];
  safeMode: boolean;
  safeModeReason: string | null;
}

export function initialSupervisorState(nowMs: number): SupervisorState {
  return {
    lastProgressAtMs: nowMs,
    healthySinceMs: nowMs,
    escalationStep: 0,
    lastActionAtMs: null,
    ladderRunsAtMs: [],
    safeMode: false,
    safeModeReason: null,
  };
}

/** Record observed playback progress. */
export function onProgress(
  state: SupervisorState,
  nowMs: number,
  config: SupervisorConfig,
): SupervisorState {
  const next: SupervisorState = {
    ...state,
    lastProgressAtMs: nowMs,
    healthySinceMs: state.healthySinceMs ?? nowMs,
  };
  if (
    next.healthySinceMs !== null &&
    nowMs - next.healthySinceMs >= config.healthyClearMs
  ) {
    // A meaningful healthy period clears failure history and the ladder.
    next.escalationStep = 0;
    next.lastActionAtMs = null;
    next.ladderRunsAtMs = [];
  }
  return next;
}

export interface HealDecision {
  action: HealAction;
  state: SupervisorState;
}

/**
 * Evaluate whether a heal action is due. Call periodically (e.g. every 15s).
 */
export function evaluate(
  state: SupervisorState,
  nowMs: number,
  config: SupervisorConfig,
): HealDecision {
  if (state.safeMode) {
    return { action: "none", state };
  }

  const stalled = nowMs - state.lastProgressAtMs >= config.stallThresholdMs;
  if (!stalled) {
    return { action: "none", state };
  }

  // Stalled: healthy streak is broken.
  const base: SupervisorState = { ...state, healthySinceMs: null };

  if (
    base.lastActionAtMs !== null &&
    nowMs - base.lastActionAtMs < config.actionSpacingMs
  ) {
    // Give the previous action time to take effect.
    return { action: "none", state: base };
  }

  if (base.escalationStep >= LADDER.length) {
    // Ladder exhausted this outage.
    const runs = [...base.ladderRunsAtMs, nowMs].filter(
      (t) => nowMs - t <= config.ladderRunWindowMs,
    );
    if (runs.length >= config.maxLadderRunsBeforeSafeMode) {
      return {
        action: "enter_safe_mode",
        state: {
          ...base,
          ladderRunsAtMs: runs,
          safeMode: true,
          safeModeReason: "recovery ladder exhausted repeatedly",
          lastActionAtMs: nowMs,
        },
      };
    }
    // Start the ladder again from the top, but only after full spacing.
    return {
      action: LADDER[0]!,
      state: {
        ...base,
        ladderRunsAtMs: runs,
        escalationStep: 1,
        lastActionAtMs: nowMs,
      },
    };
  }

  const action = LADDER[base.escalationStep]!;
  return {
    action,
    state: {
      ...base,
      escalationStep: base.escalationStep + 1,
      lastActionAtMs: nowMs,
    },
  };
}

/** Leaving safe mode (operator command or confirmed recovery). */
export function clearSafeMode(
  state: SupervisorState,
  nowMs: number,
): SupervisorState {
  return {
    ...state,
    safeMode: false,
    safeModeReason: null,
    escalationStep: 0,
    lastActionAtMs: null,
    ladderRunsAtMs: [],
    lastProgressAtMs: nowMs,
    healthySinceMs: null,
  };
}
