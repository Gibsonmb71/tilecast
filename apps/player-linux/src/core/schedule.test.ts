import { describe, expect, it } from "vitest";
import { resolveSelection, scheduleApplies } from "./schedule";
import type { Manifest, ManifestSchedule } from "./types";

function baseManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    schemaVersion: 11,
    manifestVersion: 1,
    screenId: "screen-1",
    generatedAt: "2026-07-17T00:00:00Z",
    mode: "presentation",
    playlist: { id: "direct", revision: 1, name: "Direct", items: [] },
    playlists: [{ id: "scheduled", revision: 1, name: "Scheduled", items: [] }],
    schedules: [],
    assets: [],
    serverTime: "2026-07-17T00:00:00Z",
    prefetchHorizonDays: 7,
    activationGraceSeconds: 30,
    websites: [],
    ...overrides,
  };
}

function weekly(overrides: Partial<ManifestSchedule> = {}): ManifestSchedule {
  return {
    id: "sched-1",
    playlistId: "scheduled",
    type: "weekly",
    timezone: "America/New_York",
    priority: 10,
    specificity: 1,
    dailyStart: "09:00",
    dailyEnd: "17:00",
    daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
    ...overrides,
  };
}

describe("scheduleApplies", () => {
  // 2026-07-17 is a Friday. 15:00 UTC = 11:00 in New York (EDT).
  const fridayMorningNY = new Date("2026-07-17T15:00:00Z");
  // 02:00 in New York on Friday.
  const fridayNightNY = new Date("2026-07-17T06:00:00Z");

  it("matches inside a weekday window in the schedule timezone", () => {
    expect(scheduleApplies(weekly(), fridayMorningNY)).toBe(true);
  });

  it("does not match outside hours", () => {
    expect(scheduleApplies(weekly(), fridayNightNY)).toBe(false);
  });

  it("does not match on unselected days", () => {
    // Sunday 2026-07-19, 11:00 NY.
    const sunday = new Date("2026-07-19T15:00:00Z");
    expect(scheduleApplies(weekly(), sunday)).toBe(false);
  });

  it("half-open end: exactly the end minute is excluded", () => {
    // 17:00 NY on Friday = 21:00 UTC.
    const atEnd = new Date("2026-07-17T21:00:00Z");
    expect(scheduleApplies(weekly(), atEnd)).toBe(false);
    const justBefore = new Date("2026-07-17T20:59:00Z");
    expect(scheduleApplies(weekly(), justBefore)).toBe(true);
  });

  it("overnight window belongs to the start day", () => {
    const overnight = weekly({
      dailyStart: "22:00",
      dailyEnd: "06:00",
      daysOfWeek: [5], // Friday nights
    });
    // Friday 23:00 NY = Sat 03:00 UTC.
    expect(scheduleApplies(overnight, new Date("2026-07-18T03:00:00Z"))).toBe(true);
    // Saturday 02:00 NY (early morning after Friday) = Sat 06:00 UTC.
    expect(scheduleApplies(overnight, new Date("2026-07-18T06:00:00Z"))).toBe(true);
    // Saturday 07:00 NY — past the end.
    expect(scheduleApplies(overnight, new Date("2026-07-18T11:00:00Z"))).toBe(false);
    // Thursday 23:00 NY — wrong start day.
    expect(scheduleApplies(overnight, new Date("2026-07-17T03:00:00Z"))).toBe(false);
  });

  it("respects start and end dates in the schedule timezone", () => {
    const bounded = weekly({ startDate: "2026-07-20", endDate: "2026-07-25" });
    expect(scheduleApplies(bounded, new Date("2026-07-17T15:00:00Z"))).toBe(false);
  });

  it("one-time schedules use half-open UTC instants", () => {
    const oneTime: ManifestSchedule = {
      id: "ot",
      playlistId: "scheduled",
      type: "one_time",
      timezone: "UTC",
      priority: 5,
      specificity: 2,
      oneTimeStart: "2026-07-17T10:00:00Z",
      oneTimeEnd: "2026-07-17T12:00:00Z",
    };
    expect(scheduleApplies(oneTime, new Date("2026-07-17T10:00:00Z"))).toBe(true);
    expect(scheduleApplies(oneTime, new Date("2026-07-17T12:00:00Z"))).toBe(false);
  });

  it("an unknown timezone never applies rather than throwing", () => {
    expect(
      scheduleApplies(weekly({ timezone: "Not/AZone" }), fridayMorningNY),
    ).toBe(false);
  });
});

describe("resolveSelection", () => {
  const inWindow = new Date("2026-07-17T15:00:00Z");

  it("falls back to the direct assignment with no schedules", () => {
    const selection = resolveSelection(baseManifest(), inWindow);
    expect(selection).toMatchObject({ playlistId: "direct", source: "direct" });
  });

  it("an applicable schedule beats the direct assignment", () => {
    const manifest = baseManifest({ schedules: [weekly()] });
    const selection = resolveSelection(manifest, inWindow);
    expect(selection).toMatchObject({
      playlistId: "scheduled",
      scheduleId: "sched-1",
      source: "schedule",
    });
  });

  it("higher priority wins; specificity breaks ties", () => {
    const manifest = baseManifest({
      playlists: [
        { id: "a", revision: 1, name: "A", items: [] },
        { id: "b", revision: 1, name: "B", items: [] },
      ],
      schedules: [
        weekly({ id: "low", playlistId: "a", priority: 1, specificity: 9 }),
        weekly({ id: "high", playlistId: "b", priority: 2, specificity: 0 }),
      ],
    });
    expect(resolveSelection(manifest, inWindow).playlistId).toBe("b");
  });

  it("an active emergency overrides everything, honoring [start, end)", () => {
    const manifest = baseManifest({
      schedules: [weekly()],
      emergency: {
        id: "em-1",
        playlistId: "emergency-pl",
        activatedAt: "2026-07-17T14:00:00Z",
        expiresAt: "2026-07-17T16:00:00Z",
      },
    });
    expect(resolveSelection(manifest, inWindow)).toMatchObject({
      playlistId: "emergency-pl",
      emergencyId: "em-1",
      source: "emergency",
    });
    // After expiry the schedule returns.
    expect(
      resolveSelection(manifest, new Date("2026-07-17T16:00:00Z")).source,
    ).toBe("schedule");
  });

  it("restores the direct assignment when no schedule is active", () => {
    const manifest = baseManifest({ schedules: [weekly()] });
    const nightSelection = resolveSelection(
      manifest,
      new Date("2026-07-17T06:00:00Z"),
    );
    expect(nightSelection).toMatchObject({ playlistId: "direct", source: "direct" });
  });
});
