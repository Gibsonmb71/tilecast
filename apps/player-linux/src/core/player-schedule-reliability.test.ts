import { describe, expect, it } from "vitest";
import {
  manifestActivationGraceMilliseconds,
  presentationIdentity,
  type Presentation,
} from "./player";
import type { Manifest } from "./types";

function manifest(grace: number): Manifest {
  return {
    schemaVersion: 11,
    manifestVersion: 1,
    screenId: "screen",
    generatedAt: "2026-07-21T00:00:00Z",
    mode: "presentation",
    playlists: [],
    schedules: [],
    assets: [],
    serverTime: "2026-07-21T00:00:00Z",
    prefetchHorizonDays: 14,
    activationGraceSeconds: grace,
    websites: [],
  };
}

describe("schedule delivery reliability", () => {
  it("uses the bounded server activation grace", () => {
    expect(manifestActivationGraceMilliseconds(manifest(30))).toBe(30_000);
    expect(manifestActivationGraceMilliseconds(manifest(0))).toBe(30_000);
    expect(manifestActivationGraceMilliseconds(manifest(9_999))).toBe(
      3_600_000,
    );
  });

  it("does not treat the renderer generation as a content change", () => {
    const base: Presentation = {
      state: "playing",
      items: [],
      emergency: false,
      generation: 1,
    };
    expect(presentationIdentity(base)).toBe(
      presentationIdentity({ ...base, generation: 2 }),
    );
  });
});
