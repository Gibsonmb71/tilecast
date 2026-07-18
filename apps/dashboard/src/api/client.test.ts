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
});
