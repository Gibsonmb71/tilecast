import { describe, expect, it } from "vitest";
import { resolveCountdownBar } from "./countdown-bar";
import type { ManifestCountdownBarPlugin } from "./types";

function weekly(
  overrides: Partial<ManifestCountdownBarPlugin["config"]> = {},
): ManifestCountdownBarPlugin {
  return {
    id: "bar-1",
    type: "countdown_bar",
    version: 1,
    config: {
      name: "Lunch",
      message: "Lunch ends in",
      scheduleType: "weekly",
      targetTime: "12:00",
      daysOfWeek: [1],
      timezone: "America/New_York",
      leadTimeSeconds: 900,
      completionText: "Lunch is over",
      displayMode: "overlay",
      heightPx: 72,
      priority: 10,
      ...overrides,
    },
  };
}

describe("resolveCountdownBar", () => {
  it("evaluates weekly wall time in the configured timezone", () => {
    const active = resolveCountdownBar(
      [weekly()],
      new Date("2026-07-27T15:50:00Z"),
    );
    expect(active).toMatchObject({
      message: "Lunch ends in",
      value: "10:00",
      targetAt: "2026-07-27T16:00:00.000Z",
    });
  });

  it("shows completion text for one minute and then hides", () => {
    const plugin: ManifestCountdownBarPlugin = {
      ...weekly(),
      config: {
        ...weekly().config,
        scheduleType: "one_time",
        targetTime: null,
        daysOfWeek: [],
        oneTimeAt: "2026-07-27T16:00:00Z",
      },
    };
    expect(
      resolveCountdownBar([plugin], new Date("2026-07-27T16:00:30Z"))?.value,
    ).toBe("Lunch is over");
    expect(
      resolveCountdownBar([plugin], new Date("2026-07-27T16:01:01Z")),
    ).toBeNull();
  });

  it("selects the highest-priority active instance", () => {
    const low = weekly({ priority: 1, message: "Low" });
    const high = {
      ...weekly({ priority: 50, message: "High", displayMode: "push" }),
      id: "bar-2",
    };
    expect(
      resolveCountdownBar([low, high], new Date("2026-07-27T15:50:00Z")),
    ).toMatchObject({ id: "bar-2", message: "High", displayMode: "push" });
  });

  it("applies the persisted server clock offset", () => {
    expect(
      resolveCountdownBar(
        [weekly()],
        new Date("2026-07-27T15:45:00Z"),
        5 * 60_000,
      )?.value,
    ).toBe("10:00");
  });
});
