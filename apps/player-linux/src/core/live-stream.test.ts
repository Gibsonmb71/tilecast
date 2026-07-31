import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api";
import { LiveStream } from "./live-stream";
import { encodeLiveStreamFrame } from "./socket";

describe("live stream binary protocol", () => {
  it("encodes the bounded frame header expected by the server", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9]);
    const encoded = encodeLiveStreamFrame(
      "bffef4b1-f9b5-4b25-9d4f-864fba88d86d",
      1_775_000_000_123,
      640,
      360,
      jpeg,
    );

    expect(encoded.subarray(0, 4).toString("ascii")).toBe("TCLS");
    expect(encoded.readUInt8(4)).toBe(1);
    expect(encoded.readBigInt64BE(21)).toBe(1_775_000_000_123n);
    expect(encoded.readUInt16BE(29)).toBe(640);
    expect(encoded.readUInt16BE(31)).toBe(360);
    expect(encoded.subarray(33)).toEqual(jpeg);
  });
});

describe("LiveStream", () => {
  it("captures only while an active lease exists", async () => {
    vi.useFakeTimers();
    const now = Date.parse("2026-07-30T12:00:00Z");
    const client = {
      liveStreamSession: vi.fn(async () => ({
        id: "bffef4b1-f9b5-4b25-9d4f-864fba88d86d",
        active: true,
        expiresAt: "2026-07-30T12:00:15Z",
        frameIntervalMillis: 125,
        maxWidth: 640,
        maxHeight: 360,
        maxFrameBytes: 102_400,
      })),
    } as unknown as ApiClient;
    const host = {
      capture: vi.fn(async () => ({
        jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        width: 640,
        height: 360,
      })),
      send: vi.fn(() => true),
    };
    const stream = new LiveStream(client, host, () => now);

    stream.start();
    await vi.advanceTimersByTimeAsync(275);
    stream.stop();

    expect(host.capture).toHaveBeenCalledTimes(3);
    expect(host.send).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
