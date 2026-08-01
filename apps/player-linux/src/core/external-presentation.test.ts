import { describe, expect, it } from "vitest";
import {
  chooseAirplayGateway,
  commonAirplayProfile,
  isAirplayDeviceId,
  isAirplayPin,
  randomAirplayDeviceId,
  randomAirplayPin,
} from "./external-presentation";
import {
  buildReceiverArgs,
  parseUxplayVersion,
  selectDecoder,
  versionAtLeast,
} from "../main/airplay";

describe("AirPlay external presentation policy", () => {
  it("selects the preferred eligible gateway before capability ranking", () => {
    const selected = chooseAirplayGateway(
      [
        {
          id: "b",
          name: "B",
          online: true,
          platform: "linux",
          airplaySupported: true,
          hardwareH264Decode: true,
          wired: true,
        },
        {
          id: "a",
          name: "A",
          online: true,
          platform: "linux",
          airplaySupported: true,
          hardwareH264Decode: true,
          wired: true,
        },
      ],
      "a",
    );
    expect(selected?.id).toBe("a");
  });

  it("uses a deterministic name/id tie-breaker", () => {
    const candidates = [
      {
        id: "2",
        name: "Cafeteria TV",
        online: true,
        platform: "linux",
        airplaySupported: true,
        hardwareH264Decode: false,
        wired: false,
      },
      {
        id: "1",
        name: "Cafeteria TV",
        online: true,
        platform: "linux",
        airplaySupported: true,
        hardwareH264Decode: false,
        wired: false,
      },
    ];
    expect(chooseAirplayGateway(candidates)?.id).toBe("1");
  });

  it("selects 1080p30 only when every display can hardware-decode it", () => {
    expect(
      commonAirplayProfile([
        { hardwareH264Decode: true, maxProfile: "1080p30" },
        { hardwareH264Decode: true, maxProfile: "1080p30" },
      ]),
    ).toBe("1080p30");
    expect(
      commonAirplayProfile([
        { hardwareH264Decode: true, maxProfile: "1080p30" },
        { hardwareH264Decode: false, maxProfile: "720p30" },
      ]),
    ).toBe("720p30");
  });

  it("generates a four-digit pin and locally administered device id", () => {
    const pin = randomAirplayPin(Buffer.from([0, 0, 0, 42]));
    const deviceId = randomAirplayDeviceId(Buffer.from([0, 1, 2, 3, 4, 5]));
    expect(pin).toBe("0042");
    expect(isAirplayPin(pin)).toBe(true);
    expect(isAirplayDeviceId(deviceId)).toBe(true);
    expect(deviceId).toBe("02:01:02:03:04:05");
  });

  it("parses the supported baseline and keeps decoder preference stable", () => {
    expect(parseUxplayVersion("UxPlay 1.73.6\n")).toBe("1.73.6");
    expect(versionAtLeast("1.73.6", "1.73.6")).toBe(true);
    expect(versionAtLeast("1.72.9", "1.73.6")).toBe(false);
    expect(
      selectDecoder({ vah264dec: false, vaapih264dec: true, avdec_h264: true }),
    ).toBe("vaapih264dec");
    expect(
      selectDecoder({
        vah264dec: false,
        vaapih264dec: false,
        avdec_h264: true,
      }),
    ).toBe("avdec_h264");
  });

  it("builds a small H.264 receiver pipeline with a bounded jitter buffer", () => {
    const args = buildReceiverArgs({
      videoPort: 42_000,
      profile: "720p30",
      decoder: "vah264dec",
      videoSink: "vaapisink",
    });
    expect(args).toContain("rtpjitterbuffer");
    expect(args).toContain("latency=80");
    expect(args).toContain("vah264dec");
    expect(args).toContain("video/x-raw,width=1280,height=720");
    expect(args).toContain('video-sink="vaapisink fullscreen=true"');
  });

  it("joins the controlled multicast group when multicast is selected", () => {
    const args = buildReceiverArgs({
      videoPort: 42_000,
      profile: "720p30",
      decoder: "vah264dec",
      transport: "multicast",
      multicastAddress: "239.255.42.7",
    });
    expect(args).toContain("multicast-group=239.255.42.7");
    expect(args).toContain("auto-multicast=true");
  });
});
