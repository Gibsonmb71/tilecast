import { describe, expect, it } from "vitest";
import {
  activityRangeParams,
  activityTabFilterKeys,
  allActivityFilterKeys,
  buildActivityLink,
  screenActivityLink,
} from "./activityLinks";

describe("buildActivityLink date ranges", () => {
  it("keeps a preset range so a drill-down measures the same period", () => {
    expect(
      buildActivityLink("proof", { result: "failed" }, { range: "30d" }),
    ).toBe("/activity?tab=proof&range=30d&result=failed");
  });

  it("keeps both bounds of a custom range", () => {
    expect(
      buildActivityLink(
        "events",
        { category: "updates", result: "failed" },
        { range: "custom", from: "2026-07-01T00:00", to: "2026-07-14T12:30" },
      ),
    ).toBe(
      "/activity?tab=events&range=custom&from=2026-07-01T00%3A00&to=2026-07-14T12%3A30&category=updates&result=failed",
    );
  });

  it("drops stale bounds a preset range does not use", () => {
    const link = buildActivityLink(
      "proof",
      {},
      { range: "7d", from: "2026-07-01T00:00", to: "2026-07-14T12:30" },
    );
    expect(link).toBe("/activity?tab=proof&range=7d");
  });

  it("omits the range when the reader has not chosen one", () => {
    expect(buildActivityLink("proof", { result: "failed" })).toBe(
      "/activity?tab=proof&result=failed",
    );
  });

  it("reads the range straight out of the current URL", () => {
    const params = new URLSearchParams("tab=overview&range=custom&from=a&to=b");
    expect(activityRangeParams(params)).toEqual({
      range: "custom",
      from: "a",
      to: "b",
    });
  });
});

describe("buildActivityLink filter validity", () => {
  it("drops a filter the destination tab cannot apply", () => {
    // The Audit Log has no screen or category control.
    expect(
      buildActivityLink(
        "audit",
        { screen: "screen-1", category: "updates", result: "success" },
        { range: "24h" },
      ),
    ).toBe("/activity?tab=audit&range=24h&result=success");
  });

  it("drops a result value the destination tab does not recognise", () => {
    // "failed" belongs to playback; the Audit Log calls it "failure".
    expect(buildActivityLink("audit", { result: "failed" })).toBe(
      "/activity?tab=audit",
    );
  });

  it("drops a severity outside the known set", () => {
    expect(buildActivityLink("events", { severity: "catastrophic" })).toBe(
      "/activity?tab=events",
    );
  });

  it("carries an advanced proof filter", () => {
    expect(buildActivityLink("proof", { media: "asset-1" })).toBe(
      "/activity?tab=proof&media=asset-1",
    );
  });

  it("ignores empty values rather than emitting a bare key", () => {
    expect(buildActivityLink("proof", { result: "", screen: undefined })).toBe(
      "/activity?tab=proof",
    );
  });

  it("leaves the Overview tab unnamed and unfiltered", () => {
    expect(buildActivityLink("overview", { screen: "screen-1" })).toBe(
      "/activity",
    );
    expect(buildActivityLink("overview", {}, { range: "7d" })).toBe(
      "/activity?range=7d",
    );
  });

  it("covers every tab's keys in the combined clear-on-switch list", () => {
    for (const keys of Object.values(activityTabFilterKeys)) {
      for (const key of keys) expect(allActivityFilterKeys).toContain(key);
    }
  });
});

describe("screenActivityLink", () => {
  it("opens the screen's own Activity tab", () => {
    expect(screenActivityLink("screen-1")).toBe(
      "/screens/screen-1?tab=activity",
    );
  });
});
