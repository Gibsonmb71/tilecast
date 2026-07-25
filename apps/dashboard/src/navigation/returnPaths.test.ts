import { describe, expect, it } from "vitest";
import { inAppPath } from "./returnPaths";

describe("inAppPath", () => {
  it("accepts an absolute in-app path", () => {
    expect(inAppPath("/layouts/layout-1")).toBe("/layouts/layout-1");
  });

  it("keeps a query string on the path", () => {
    expect(inAppPath("/layouts/layout-1?tab=content")).toBe(
      "/layouts/layout-1?tab=content",
    );
  });

  // These arrive from the URL, so an attacker-supplied value must not become a navigation target.
  it.each<string | null>([
    "//evil.example.com", // protocol-relative
    "/\\evil.example.com", // browser-normalized protocol-relative path
    "https://evil.example.com", // absolute URL
    "javascript:alert(1)", // scheme
    "widgets", // relative path
    "", // empty
    null, // absent
  ])("rejects %s", (value) => {
    expect(inAppPath(value)).toBeNull();
  });
});
