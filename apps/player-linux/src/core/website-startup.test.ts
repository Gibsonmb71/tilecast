import { describe, expect, it, beforeEach } from "vitest";
import {
  resetWebsiteStartupGateForTests,
  shouldClearWebsiteDataAtStartup,
} from "./website-startup";

describe("website clearOnRestart startup gate", () => {
  beforeEach(() => resetWebsiteStartupGateForTests());

  it("evaluates the policy once for the process", () => {
    expect(shouldClearWebsiteDataAtStartup(false)).toBe(false);
    expect(shouldClearWebsiteDataAtStartup(true)).toBe(false);
    resetWebsiteStartupGateForTests();
    expect(shouldClearWebsiteDataAtStartup(true)).toBe(true);
    expect(shouldClearWebsiteDataAtStartup(true)).toBe(false);
  });
});
