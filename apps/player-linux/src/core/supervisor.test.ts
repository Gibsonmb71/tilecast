import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  clearSafeMode,
  evaluate,
  initialSupervisorState,
  onProgress,
  type SupervisorState,
} from "./supervisor";

const config = DEFAULT_SUPERVISOR_CONFIG;
const MIN = 60_000;

function stallUntilAction(
  state: SupervisorState,
  fromMs: number,
): { state: SupervisorState; actions: string[]; nowMs: number } {
  const actions: string[] = [];
  let nowMs = fromMs;
  let current = state;
  // Simulate the 15-second evaluation tick for up to two hours of stall.
  for (let i = 0; i < (2 * 60 * MIN) / 15_000; i++) {
    nowMs += 15_000;
    const decision = evaluate(current, nowMs, config);
    current = decision.state;
    if (decision.action !== "none") {
      actions.push(decision.action);
      if (decision.action === "enter_safe_mode") {
        break;
      }
    }
  }
  return { state: current, actions, nowMs };
}

describe("self-heal supervisor", () => {
  it("does nothing while playback progresses", () => {
    let state = initialSupervisorState(0);
    for (let now = 0; now <= 30 * MIN; now += MIN) {
      state = onProgress(state, now, config);
      expect(evaluate(state, now, config).action).toBe("none");
    }
  });

  it("tolerates a long-lived still image below the stall threshold", () => {
    const state = initialSupervisorState(0);
    // 2.5 minutes without progress, threshold is 3 minutes.
    expect(evaluate(state, 150_000, config).action).toBe("none");
  });

  it("walks the escalation ladder in order with spacing", () => {
    const { actions } = stallUntilAction(initialSupervisorState(0), 0);
    expect(actions.slice(0, 4)).toEqual([
      "reactivate_content",
      "recreate_renderer",
      "recreate_window",
      "restart_process",
    ]);
  });

  it("enters safe mode after repeated ladder exhaustion", () => {
    const { actions } = stallUntilAction(initialSupervisorState(0), 0);
    expect(actions[actions.length - 1]).toBe("enter_safe_mode");
    // Three full ladder runs (with the restart resets counted) before safe mode.
    const ladderStarts = actions.filter((a) => a === "reactivate_content");
    expect(ladderStarts.length).toBe(config.maxLadderRunsBeforeSafeMode);
  });

  it("a persisted mid-ladder state resumes instead of restart-looping", () => {
    // Simulate: process restarted at step 4 (restart_process already used).
    const persisted: SupervisorState = {
      ...initialSupervisorState(0),
      escalationStep: 4,
      lastActionAtMs: 0,
    };
    // Immediately after relaunch, still stalled: it must NOT restart again
    // within the spacing window.
    const decision = evaluate(persisted, 30_000, config);
    expect(decision.action).toBe("none");
  });

  it("sustained progress clears the ladder and failure history", () => {
    let state: SupervisorState = {
      ...initialSupervisorState(0),
      escalationStep: 3,
      lastActionAtMs: 0,
      ladderRunsAtMs: [0],
    };
    let now = 0;
    for (; now <= config.healthyClearMs + MIN; now += 30_000) {
      state = onProgress(state, now, config);
    }
    expect(state.escalationStep).toBe(0);
    expect(state.ladderRunsAtMs).toEqual([]);
  });

  it("safe mode stops heal actions until cleared", () => {
    let state: SupervisorState = {
      ...initialSupervisorState(0),
      safeMode: true,
      safeModeReason: "test",
      lastProgressAtMs: -60 * MIN,
    };
    expect(evaluate(state, 0, config).action).toBe("none");
    state = clearSafeMode(state, 0);
    expect(state.safeMode).toBe(false);
    // After clearing, a fresh stall must be re-observed from scratch.
    expect(evaluate(state, 60_000, config).action).toBe("none");
  });
});
