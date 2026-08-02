import { describe, expect, it } from "vitest";
import { ServerClock } from "./clock";

describe("server clock", () => {
  it("uses a corrected time across cached startup and restart", () => {
    let local = Date.parse("2026-08-02T12:00:00Z");
    const clock = new ServerClock(() => local);
    clock.sync("2026-08-02T12:05:00Z", local);
    expect(clock.now().toISOString()).toBe("2026-08-02T12:05:00.000Z");
    const snapshot = clock.snapshot();
    local += 60_000;
    const restarted = new ServerClock(() => local);
    restarted.restore(snapshot);
    expect(restarted.now().toISOString()).toBe("2026-08-02T12:06:00.000Z");
  });

  it("keeps the last valid offset on malformed fresh time", () => {
    const local = Date.parse("2026-08-02T12:00:00Z");
    const clock = new ServerClock(() => local);
    clock.restore(30_000);
    clock.sync("not-a-time", local);
    expect(clock.nowMs()).toBe(local + 30_000);
  });
});
