import { describe, expect, it } from "vitest";
import type { AuthStatus } from "./types";

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
