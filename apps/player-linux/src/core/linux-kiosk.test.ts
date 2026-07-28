import { describe, expect, it } from "vitest";
import { linuxKioskPolicy } from "./linux-kiosk";
import type { PlayerConfig } from "./types";

function config(linuxKiosk?: Record<string, unknown>): PlayerConfig {
  return {
    schemaVersion: 1,
    configRevision: 1,
    generatedAt: "2026-07-28T12:00:00Z",
    branding: {},
    playback: {},
    cache: {},
    sync: {},
    website: {},
    reliability: {},
    power: {},
    managedKiosk: {},
    linuxKiosk,
    accessibility: {},
    updates: {},
  };
}

describe("Linux kiosk policy", () => {
  it("uses hardened defaults before configuration is available", () => {
    expect(linuxKioskPolicy(null)).toEqual({
      fullscreenEnabled: true,
      preventDisplaySleep: true,
    });
  });

  it("keeps hardened defaults when schema v1 omits the Linux kiosk section", () => {
    expect(linuxKioskPolicy(config())).toEqual({
      fullscreenEnabled: true,
      preventDisplaySleep: true,
    });
  });

  it("applies explicit Linux window and display-sleep settings", () => {
    expect(
      linuxKioskPolicy(
        config({ fullscreenEnabled: false, preventDisplaySleep: false }),
      ),
    ).toEqual({
      fullscreenEnabled: false,
      preventDisplaySleep: false,
    });
  });
});
