import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import { AirplayManager, describeLimitation } from "./airplay";
import type { ExternalPresentationConfig } from "../core/external-presentation";

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signalCode = signal;
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, signal));
    return true;
  }
}

function config(
  role: "single" | "gateway" | "receiver",
): ExternalPresentationConfig {
  return {
    provider: "airplay",
    sessionId: "8c3c4b1a-2f9b-4b5e-9ad1-3ca0b3ed0c77",
    receiverName: "HS Cafeteria",
    pin: "4821",
    deviceId: "02:11:22:33:44:55",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    role,
    targetType: role === "single" ? "screen" : "group",
    targetId: "d4c3b2a1-9876-4321-9abc-1234567890ab",
    gatewayScreenId: "d4c3b2a1-9876-4321-9abc-1234567890ab",
    audioScreenId: "d4c3b2a1-9876-4321-9abc-1234567890ab",
    transport: "unicast",
    videoPort: 42000,
    destinations:
      role === "single"
        ? []
        : [
            {
              screenId: "d4c3b2a1-9876-4321-9abc-1234567890ab",
              host: "127.0.0.1",
              port: 42000,
            },
          ],
    profile: "720p30",
    audioMode: "gateway_only",
  };
}

function testManager(spawn: (binary: string, args: string[]) => FakeProcess) {
  const files = new Map<string, unknown>();
  const store = {
    writeJson: async (name: string, value: unknown) => files.set(name, value),
    readJson: async <T>(name: string) =>
      (files.get(name) as T | undefined) ?? null,
    delete: async (name: string) => void files.delete(name),
  } as never;
  const calls: { binary: string; args: string[]; process: FakeProcess }[] = [];
  const manager = new AirplayManager({
    store,
    spawn: ((binary: string, args: string[]) => {
      const process = spawn(binary, args);
      calls.push({ binary, args, process });
      return process as never;
    }) as never,
  });
  return { manager, files, calls };
}

describe("AirPlay Linux process ownership", () => {
  it("uses UxPlay's direct fullscreen path for a single screen and cleans it up", async () => {
    const result = testManager(() => new FakeProcess());
    const session = config("single");
    await result.manager.prepareSession(session, "avdec_h264");
    await result.manager.startGateway("avdec_h264");

    expect(result.calls[0]?.binary).toBe("uxplay");
    expect(result.calls[0]?.args).toContain("-pin");
    expect(result.calls[0]?.args).toContain("4821");
    expect(result.calls[0]?.args).toContain("-vd");
    expect(result.calls[0]?.args).not.toContain("-vrtp");
    expect(result.files.has("airplay-session.json")).toBe(true);

    await result.manager.stopSession("manual_stop");
    expect(result.files.has("airplay-session.json")).toBe(false);
    expect(result.calls[0]?.process.signalCode).toBe("SIGTERM");
  });

  it("keeps the gateway compressed in group mode and prepares a local receiver", async () => {
    const result = testManager(() => new FakeProcess());
    await result.manager.prepareSession(config("gateway"), "vah264dec");
    await result.manager.startGateway("vah264dec");

    expect(result.calls.map((call) => call.binary)).toEqual([
      "gst-launch-1.0",
      "uxplay",
    ]);
    const uxplayArgs = result.calls[1]?.args ?? [];
    expect(uxplayArgs).toContain("-vs");
    expect(uxplayArgs).toContain("0");
    expect(uxplayArgs).toContain("-vrtp");
    expect(
      uxplayArgs.some((arg) =>
        arg.includes("multiudpsink clients=127.0.0.1:42000"),
      ),
    ).toBe(true);
    expect(uxplayArgs).not.toContain("-vd");

    await result.manager.stopSession("group_stop");
    expect(
      result.calls.every((call) => call.process.signalCode === "SIGTERM"),
    ).toBe(true);
  });

  it("enforces the local absolute expiry even without server contact", async () => {
    vi.useFakeTimers();
    try {
      const result = testManager(() => new FakeProcess());
      const session = config("single");
      session.expiresAt = new Date(Date.now() + 1_000).toISOString();
      await result.manager.prepareSession(session, "avdec_h264");
      await result.manager.startGateway("avdec_h264");

      await vi.advanceTimersByTimeAsync(1_100);

      expect(result.files.has("airplay-session.json")).toBe(false);
      expect(
        result.calls.every((call) => call.process.signalCode === "SIGTERM"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AirPlay capability limitation reporting", () => {
  const ready = {
    uxplayInstalled: true,
    uxplayVersion: "1.73.6",
    gstreamerInstalled: true,
    decoder: "vah264dec" as const,
    avahiAvailable: true,
    hardware: true,
    hardwarePlugin: true,
    vainfoAvailable: true,
    supported: true,
  };

  it("names UxPlay when it is absent", () => {
    const limitation = describeLimitation({
      ...ready,
      uxplayInstalled: false,
      uxplayVersion: null,
      supported: false,
    });
    expect(limitation).toContain("UxPlay is not installed");
    expect(limitation).toContain("install-airplay-support.sh");
  });

  // The common field failure: a distro package exists but predates the
  // baseline, so airplaySupported is false while uxplayInstalled is true.
  it("names the installed version when it is older than the baseline", () => {
    const limitation = describeLimitation({
      ...ready,
      uxplayVersion: "1.68",
      supported: false,
    });
    expect(limitation).toContain("1.68");
    expect(limitation).toContain("1.73.6");
  });

  it("names GStreamer and the decoder when they are missing", () => {
    expect(
      describeLimitation({ ...ready, gstreamerInstalled: false, supported: false }),
    ).toContain("GStreamer is not installed");
    expect(
      describeLimitation({ ...ready, decoder: null, supported: false }),
    ).toContain("H.264 decoder");
  });

  // Blocking dependencies outrank quality notes: a box with neither UxPlay nor
  // VA-API must be told about UxPlay first, since that is what it fixes next.
  it("reports the blocking dependency ahead of a hardware-decode note", () => {
    expect(
      describeLimitation({
        ...ready,
        uxplayInstalled: false,
        uxplayVersion: null,
        decoder: "avdec_h264",
        hardware: false,
        hardwarePlugin: false,
        supported: false,
      }),
    ).toContain("UxPlay is not installed");
  });

  it("reports nothing for a fully provisioned player", () => {
    expect(describeLimitation(ready)).toBeUndefined();
  });
});
