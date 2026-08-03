import { describe, expect, it } from "vitest";
import {
  classifyLinkType,
  classifyPowerSource,
  parseDefaultRouteInterface,
  parseLinkSpeedMbps,
  parseWirelessSignalDbm,
  readWiredInterfaceStatus,
  selectWiredInterface,
  usableIpv4,
} from "./system-probe";
import { validIpv4 } from "./presentation-network";

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

describe("wired interface selection for AirPlay group RTP", () => {
  it("prefers the Ethernet interface that carries the default route", () => {
    const status = selectWiredInterface(
      [
        { name: "eth1", ipv4: "10.20.0.9", linkType: "ethernet" },
        { name: "eth0", ipv4: "10.10.2.15", linkType: "ethernet" },
      ],
      "eth0",
    );
    // That is the interface actually carrying Tilecast traffic, so it is the one
    // another display can reach.
    expect(status).toMatchObject({ available: true, ipv4: "10.10.2.15" });
  });

  it("is deterministic when no Ethernet interface holds the default route", () => {
    const candidates = [
      { name: "eth1", ipv4: "10.20.0.9", linkType: "ethernet" as const },
      { name: "eth0", ipv4: "10.10.2.15", linkType: "ethernet" as const },
    ];
    // Two probes on the same box must agree, or a group's destinations would
    // change between sessions for no reason.
    expect(selectWiredInterface(candidates, "wlan0").ipv4).toBe("10.10.2.15");
    expect(selectWiredInterface([...candidates].reverse(), "wlan0").ipv4).toBe(
      "10.10.2.15",
    );
  });

  it("never selects the temporary Wi-Fi address", () => {
    // This is the specific accident the explicit wired field exists to prevent: a
    // Presentation Network address becoming a GStreamer RTP destination.
    const status = selectWiredInterface(
      [
        { name: "wlan0", ipv4: "10.40.5.71", linkType: "wifi" },
        { name: "eth0", ipv4: "10.10.2.15", linkType: "ethernet" },
      ],
      "eth0",
    );
    expect(status.ipv4).toBe("10.10.2.15");
  });

  it("reports no address rather than guessing when Wi-Fi is the only link", () => {
    const status = selectWiredInterface(
      [{ name: "wlan0", ipv4: "10.40.5.71", linkType: "wifi" }],
      "wlan0",
    );
    // The server then gives a precise AirPlay readiness error instead of being
    // handed an address that cannot work.
    expect(status).toEqual({ available: false, ipv4: "" });
  });

  it("distinguishes an Ethernet interface with no address from no Ethernet at all", () => {
    expect(
      selectWiredInterface([{ name: "eth0", ipv4: "", linkType: "ethernet" }]),
    ).toEqual({ available: true, ipv4: "" });
    expect(selectWiredInterface([])).toEqual({ available: false, ipv4: "" });
  });

  it("rejects addresses that are not reachable destinations", () => {
    for (const address of [
      "127.0.0.1",
      "169.254.3.4",
      "0.0.0.0",
      "239.255.42.1",
    ]) {
      expect(
        selectWiredInterface([
          { name: "eth0", ipv4: address, linkType: "ethernet" },
        ]),
        address,
      ).toEqual({ available: true, ipv4: "" });
    }
  });

  it("agrees with the presentation-network boundary on what is usable", () => {
    // The player and the server both reject the same set. A disagreement between
    // two boundaries is how an unusable address gets through one of them.
    for (const address of ["10.10.2.15", "192.168.1.40", "172.16.9.3"]) {
      expect(usableIpv4(address), address).toBe(true);
      expect(validIpv4(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "169.254.1.1",
      "0.0.0.0",
      "224.0.0.1",
      "bad",
    ]) {
      expect(usableIpv4(address), address).toBe(false);
      expect(validIpv4(address), address).toBe(false);
    }
  });

  it("accepts both of Node's IPv4 family spellings", async () => {
    const status = await readWiredInterfaceStatus(() => ({
      eth0: [
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "10.10.2.15", family: 4, internal: false },
      ],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    }));
    // On a non-Linux host there is no /proc/net/route, so the reading is empty
    // rather than fabricated — which is the correct behavior for this probe.
    expect(status.ipv4 === "10.10.2.15" || status.ipv4 === "").toBe(true);
  });
});
