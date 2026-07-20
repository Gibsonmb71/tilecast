import { describe, expect, it } from "vitest";
import { buildOutsideActiveHoursPresentation } from "./outside-hours";
import type { PlayerConfig } from "./types";

function config(
  power: Record<string, unknown>,
  branding: Record<string, unknown> = {},
): PlayerConfig {
  return {
    schemaVersion: 1,
    configRevision: 1,
    generatedAt: "2026-07-20T00:00:00Z",
    branding,
    playback: {},
    cache: {},
    sync: {},
    website: {},
    reliability: {},
    power,
    managedKiosk: {},
    accessibility: {},
    updates: {},
  };
}

describe("buildOutsideActiveHoursPresentation", () => {
  it("preserves the bouncing-logo mode", () => {
    expect(
      buildOutsideActiveHoursPresentation(
        config({ outsideActiveHoursDisplay: "bouncing_logo" }),
      ),
    ).toMatchObject({
      state: "sleep",
      display: "bouncing_logo",
      text: "Powered by Tilecast",
      textColor: "#F5F7FA",
    });
  });

  it("uses configured custom text and branding color", () => {
    expect(
      buildOutsideActiveHoursPresentation(
        config(
          {
            outsideActiveHoursDisplay: "custom_text",
            outsideActiveHoursText: "School reopens at 7 a.m.",
          },
          { textColor: "#ABCDEF" },
        ),
      ),
    ).toMatchObject({
      display: "custom_text",
      text: "School reopens at 7 a.m.",
      textColor: "#ABCDEF",
    });
  });

  it("falls back to branding footer text", () => {
    expect(
      buildOutsideActiveHoursPresentation(
        config(
          {
            outsideActiveHoursDisplay: "custom_text",
            outsideActiveHoursText: "   ",
          },
          { footerText: "Weekly Wildcat" },
        ),
      ).text,
    ).toBe("Weekly Wildcat");
  });

  it("fails unknown modes safely to black", () => {
    expect(
      buildOutsideActiveHoursPresentation(
        config({ outsideActiveHoursDisplay: "not-a-mode" }),
      ).display,
    ).toBe("black");
    expect(buildOutsideActiveHoursPresentation(null).display).toBe("black");
  });
});
