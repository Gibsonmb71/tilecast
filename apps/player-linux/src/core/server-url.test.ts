import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  it("defaults a bare host to https", () => {
    expect(normalizeServerUrl("signage.example.org")).toEqual({
      ok: true,
      url: "https://signage.example.org",
    });
  });

  it("keeps an explicit port and strips trailing slash", () => {
    expect(normalizeServerUrl("https://signage.example.org:8443/")).toEqual({
      ok: true,
      url: "https://signage.example.org:8443",
    });
  });

  it("rejects public http", () => {
    const result = normalizeServerUrl("http://signage.example.org");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/https/);
  });

  it("allows http on private ranges", () => {
    for (const host of [
      "http://192.168.1.10",
      "http://10.0.0.5:8080",
      "http://172.16.4.4",
      "http://localhost:3000",
      "http://tilecast.local",
      "http://127.0.0.1",
    ]) {
      expect(normalizeServerUrl(host).ok).toBe(true);
    }
  });

  it("treats 172.32 as public (outside the /12)", () => {
    expect(normalizeServerUrl("http://172.32.0.1").ok).toBe(false);
  });

  it("rejects embedded credentials, paths, and queries", () => {
    expect(normalizeServerUrl("https://user:pass@host.org").ok).toBe(false);
    expect(normalizeServerUrl("https://host.org/api").ok).toBe(false);
    expect(normalizeServerUrl("https://host.org/?x=1").ok).toBe(false);
  });

  it("rejects junk", () => {
    expect(normalizeServerUrl("   ").ok).toBe(false);
    expect(normalizeServerUrl("ftp://host.org").ok).toBe(false);
  });
});
