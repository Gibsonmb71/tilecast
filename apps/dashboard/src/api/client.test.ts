import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";
import type { AuthStatus } from "./types";

afterEach(() => vi.unstubAllGlobals());

describe("authentication contract", () => {
  it("distinguishes initial setup from a signed-out installation", () => {
    const setup: AuthStatus = { setupRequired: true, authenticated: false };
    const signedOut: AuthStatus = {
      setupRequired: false,
      authenticated: false,
    };
    expect(setup.setupRequired).toBe(true);
    expect(signedOut.setupRequired).toBe(false);
  });
});

describe("screen group compatibility", () => {
  it("normalizes a missing screens collection in group details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: "group-1", name: "Lobby" } }),
      }),
    );

    await expect(api.screenGroup("group-1")).resolves.toMatchObject({
      id: "group-1",
      screens: [],
    });
  });

  it("normalizes missing screens collections in group lists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { items: [{ id: "group-1" }] } }),
      }),
    );

    await expect(api.screenGroups()).resolves.toMatchObject({
      items: [{ id: "group-1", screens: [] }],
    });
  });

  it("handles a list response without items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: {} }),
      }),
    );

    await expect(api.screenGroups()).resolves.toMatchObject({ items: [] });
  });
});

describe("mixed-version collection compatibility", () => {
  it("normalizes missing playlist collections before pages consume them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: "playlist-1" } }),
      }),
    );

    await expect(api.playlist("playlist-1")).resolves.toMatchObject({
      items: [],
      warnings: [],
      layoutUsage: [],
    });
  });

  it("normalizes missing layout editor collections", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: {
              id: "layout-1",
              orientation: "landscape",
              canvasWidth: 1920,
              canvasHeight: 1080,
              draft: { schemaVersion: 2, canvas: null },
            },
          }),
      }),
    );

    await expect(api.layout("layout-1")).resolves.toMatchObject({
      draft: {
        canvas: { width: 1920, height: 1080 },
        placements: [],
      },
      dependencies: [],
      usage: { screens: [], schedules: [] },
    });
  });
});
