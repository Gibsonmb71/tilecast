import { describe, expect, it } from "vitest";
import { inAppPath, withParam } from "./returnPaths";

describe("inAppPath", () => {
  it("accepts an absolute in-app path", () => {
    expect(inAppPath("/layouts/layout-1")).toBe("/layouts/layout-1");
  });

  it("keeps a query string on the path", () => {
    expect(inAppPath("/start/lunch-menu?screen=s1")).toBe(
      "/start/lunch-menu?screen=s1",
    );
  });

  // These arrive from the URL, so an attacker-supplied value must not become a navigation target.
  it.each<string | null>([
    "//evil.example.com", // protocol-relative
    "https://evil.example.com", // absolute URL
    "javascript:alert(1)", // scheme
    "widgets", // relative path
    "", // empty
    null, // absent
  ])("rejects %s", (value) => {
    expect(inAppPath(value)).toBeNull();
  });
});

describe("withParam", () => {
  it("adds a parameter to a path that has none", () => {
    expect(withParam("/start/lunch-menu", "widget", "w1")).toBe(
      "/start/lunch-menu?widget=w1",
    );
  });

  it("preserves existing parameters", () => {
    expect(withParam("/start/lunch-menu?screen=s1", "widget", "w1")).toBe(
      "/start/lunch-menu?screen=s1&widget=w1",
    );
  });

  it("replaces a parameter that is already set", () => {
    expect(withParam("/start/x?widget=old", "widget", "new")).toBe(
      "/start/x?widget=new",
    );
  });

  it("encodes values that need it", () => {
    expect(withParam("/start/x", "name", "a b&c")).toBe(
      "/start/x?name=a+b%26c",
    );
  });
});
