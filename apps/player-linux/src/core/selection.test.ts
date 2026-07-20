import { describe, expect, it } from "vitest";
import {
  localDate,
  selectByDate,
  selectCalendarEvents,
  windowForMode,
} from "./selection";

const tz = "America/New_York";
// Wednesday 2026-07-15 12:00 EDT.
const now = new Date("2026-07-15T12:00:00-04:00");

const rec = (date: string) => ({ date });

describe("localDate", () => {
  it("resolves the local calendar date", () => {
    expect(localDate(tz, now)).toBe("2026-07-15");
    // 00:30 UTC is still the previous evening in New York.
    expect(localDate(tz, new Date("2026-07-16T00:30:00Z"))).toBe("2026-07-15");
  });
});

describe("windowForMode", () => {
  it("computes half-open windows", () => {
    expect(windowForMode("today", tz, now)).toEqual({
      start: "2026-07-15",
      end: "2026-07-16",
    });
    expect(windowForMode("tomorrow", tz, now)).toEqual({
      start: "2026-07-16",
      end: "2026-07-17",
    });
    // Current week starts Monday 2026-07-13.
    expect(windowForMode("current_week", tz, now)).toEqual({
      start: "2026-07-13",
      end: "2026-07-20",
    });
  });
});

describe("selectByDate", () => {
  const records = [
    rec("2026-07-14"),
    rec("2026-07-15"),
    rec("2026-07-15"),
    rec("2026-07-18"),
    rec("2026-08-01"),
  ];

  it("selects today's records", () => {
    const result = selectByDate(records, {
      mode: "today",
      timezone: tz,
      at: now,
    });
    expect(result.records).toHaveLength(2);
    expect(result.records.every((r) => r.date === "2026-07-15")).toBe(true);
  });

  it("next_available finds the earliest upcoming date", () => {
    const future = [rec("2026-07-18"), rec("2026-08-01"), rec("2026-07-18")];
    const result = selectByDate(future, {
      mode: "next_available",
      timezone: tz,
      at: now,
    });
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.date).toBe("2026-07-18");
  });

  it("honors no-match behaviors", () => {
    const past = [rec("2020-01-01")];
    expect(
      selectByDate(past, {
        mode: "today",
        timezone: tz,
        at: now,
        noMatchBehavior: "hide",
      }).hidden,
    ).toBe(true);
    expect(
      selectByDate(past, {
        mode: "today",
        timezone: tz,
        at: now,
        noMatchBehavior: "fallback_text",
      }).usedFallback,
    ).toBe(true);
    // next_available fallback jumps forward even when today has nothing.
    const upcoming = selectByDate([rec("2026-07-20"), rec("2020-01-01")], {
      mode: "today",
      timezone: tz,
      at: now,
      noMatchBehavior: "next_available",
    });
    expect(upcoming.records[0]!.date).toBe("2026-07-20");
  });
});

describe("selectCalendarEvents", () => {
  // now is Wed 2026-07-15 12:00 EDT.
  const events = [
    { start: "2026-07-15T15:00:00-04:00", end: "2026-07-15T16:00:00-04:00" }, // today, later
    { start: "2026-07-15T08:00:00-04:00", end: "2026-07-15T08:30:00-04:00" }, // today, past
    { start: "2026-07-17T09:00:00-04:00", end: "2026-07-17T10:00:00-04:00" }, // Fri, this week
    { start: "2026-07-25T09:00:00-04:00", end: "2026-07-25T10:00:00-04:00" }, // next week
  ];

  it("drops finished events and sorts by start", () => {
    const upcoming = selectCalendarEvents(events, "upcoming", tz, now, 10);
    expect(upcoming).toHaveLength(3);
    expect(upcoming[0]!.start).toBe("2026-07-15T15:00:00-04:00");
  });

  it("filters to today", () => {
    const today = selectCalendarEvents(events, "today", tz, now, 10);
    expect(today).toHaveLength(1);
  });

  it("filters to the current week and caps count", () => {
    const week = selectCalendarEvents(events, "this_week", tz, now, 1);
    expect(week).toHaveLength(1);
  });
});
