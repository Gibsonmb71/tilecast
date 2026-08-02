import { describe, expect, it } from "vitest";
import { cacheIdentityMatches, makeCacheIdentity } from "./cache-identity";

describe("cache identity", () => {
  const identity = makeCacheIdentity(
    "https://signage.example.test/",
    "installation-a",
    "screen-a",
  )!;

  it("normalizes the server URL and accepts an offline restart for the same screen", () => {
    expect(identity.normalizedServerUrl).toBe("https://signage.example.test");
    expect(cacheIdentityMatches(identity, identity)).toBe(true);
  });

  it.each([
    ["server replacement", { installationId: "installation-b" }],
    ["re-pairing to another screen", { screenId: "screen-b" }],
    [
      "server URL replacement",
      { normalizedServerUrl: "https://other.example.test" },
    ],
  ])("rejects cached playback after %s", (_reason, change) => {
    expect(cacheIdentityMatches(identity, { ...identity, ...change })).toBe(
      false,
    );
  });

  it("does not create an identity before pairing has supplied all fields", () => {
    expect(
      makeCacheIdentity("https://signage.example.test", null, "screen-a"),
    ).toBeNull();
    expect(
      makeCacheIdentity("https://signage.example.test", "installation-a", null),
    ).toBeNull();
  });
});
