import { describe, expect, it } from "vitest";
import "./countdown-display";

interface CountdownDisplay {
  compact(remainingMilliseconds: number): string;
}

const display = (
  globalThis as typeof globalThis & {
    tilecastCountdownDisplay: CountdownDisplay;
  }
).tilecastCountdownDisplay;

describe("compact countdown display", () => {
  it("shows seconds below one hour", () => {
    expect(display.compact((42 * 60 + 18) * 1_000)).toBe("42m 18s");
    expect(display.compact(18_000)).toBe("18s");
  });

  it("uses coarser units for longer countdowns and Now at completion", () => {
    expect(display.compact((26 * 60 * 60 + 3 * 60) * 1_000)).toBe("1d 2h");
    expect(display.compact((2 * 60 * 60 + 3 * 60) * 1_000)).toBe("2h 3m");
    expect(display.compact(0)).toBe("Now");
    expect(display.compact(-1)).toBe("Now");
  });
});
