import { describe, expect, it } from "vitest";
import {
  classifyLinkType,
  classifyPowerSource,
  parseDefaultRouteInterface,
  parseLinkSpeedMbps,
  parseWirelessSignalDbm,
} from "./system-probe";

// Real /proc/net/route output. The default route is the only row whose
// destination is all zeroes, and it is not necessarily the first row.
const ROUTE_TABLE = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
enp0s31f6\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0
wlp3s0\t0000A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0
wlp3s0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
`;

describe("default route interface", () => {
  it("picks the interface carrying the default route, not the first one up", () => {
    // The wired interface has a subnet route but no default route: reporting
    // its link quality would describe a path the player is not using.
    expect(parseDefaultRouteInterface(ROUTE_TABLE)).toBe("wlp3s0");
  });

  it("reports nothing when there is no default route", () => {
    const lines = ROUTE_TABLE.split("\n")
      .filter((line) => !line.includes("00000000\t0100A8C0"))
      .join("\n");
    expect(parseDefaultRouteInterface(lines)).toBeUndefined();
  });

  it("survives an empty or truncated table", () => {
    expect(parseDefaultRouteInterface("")).toBeUndefined();
    expect(parseDefaultRouteInterface("Iface\tDestination\n")).toBeUndefined();
  });
});

describe("link classification", () => {
  it("trusts sysfs over the interface name", () => {
    // A wireless interface renamed to look wired is still wireless, and this is
    // the case where guessing from the name reports the wrong link entirely.
    expect(classifyLinkType("eth0", true)).toBe("wifi");
  });

  it("falls back to predictable and legacy names", () => {
    expect(classifyLinkType("enp0s31f6", false)).toBe("ethernet");
    expect(classifyLinkType("eth0", false)).toBe("ethernet");
    expect(classifyLinkType("wlp3s0", false)).toBe("wifi");
    expect(classifyLinkType("wwan0", false)).toBe("cellular");
    expect(classifyLinkType("tun0", false)).toBe("unknown");
  });
});

describe("wireless signal", () => {
  const table = `Inter-| sta-|   Quality        |   Discarded packets
 face | tus | link level noise |  nwid  crypt   frag  retry
 wlp3s0: 0000   58.  -52.  -256        0      0      0      0
`;

  it("reads the level column in dBm", () => {
    expect(parseWirelessSignalDbm(table, "wlp3s0")).toBe(-52);
  });

  it("converts a driver that reports an unsigned byte", () => {
    const unsigned = table.replace("-52.", "204.");
    expect(parseWirelessSignalDbm(unsigned, "wlp3s0")).toBe(-52);
  });

  it("reports nothing for an interface that is not listed", () => {
    expect(parseWirelessSignalDbm(table, "wlan9")).toBeUndefined();
  });

  it("drops a value outside any real radio's range", () => {
    expect(
      parseWirelessSignalDbm(table.replace("-52.", "-400."), "wlp3s0"),
    ).toBeUndefined();
  });
});

describe("link speed", () => {
  it("reads a speed in Mbit/s", () => {
    expect(parseLinkSpeedMbps("1000\n")).toBe(1000);
  });

  it("treats the kernel's unknown marker as unknown, not as a speed", () => {
    expect(parseLinkSpeedMbps("-1\n")).toBeUndefined();
    expect(parseLinkSpeedMbps("")).toBeUndefined();
  });
});

describe("power source", () => {
  it("reports mains when the adapter is online, even with a battery present", () => {
    // Otherwise every laptop-class device on a wall socket reads as running on
    // battery, which is the alarm nobody should get.
    const result = classifyPowerSource([
      { type: "Mains", online: true },
      { type: "Battery", capacityPercent: 97 },
    ]);
    expect(result.powerSource).toBe("mains");
    expect(result.batteryPercent).toBe(97);
  });

  it("reports battery only when the adapter is confirmed offline", () => {
    const result = classifyPowerSource([
      { type: "Mains", online: false },
      { type: "Battery", capacityPercent: 41 },
    ]);
    expect(result.powerSource).toBe("battery");
    expect(result.batteryPercent).toBe(41);
  });

  it("prefers a UPS when one is online", () => {
    expect(
      classifyPowerSource([
        { type: "Mains", online: true },
        { type: "UPS", online: true },
      ]).powerSource,
    ).toBe("ups");
  });

  it("reports nothing at all when sysfs exposes no supply", () => {
    // The common case for fixed-install signage. "mains" here would be an
    // assumption indistinguishable from a real reading.
    expect(classifyPowerSource([]).powerSource).toBeUndefined();
  });
});
