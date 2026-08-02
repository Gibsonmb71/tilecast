import { describe, expect, it } from "vitest";
import type { ReliabilityStatus } from "../api/types";
import {
  airplayCapabilityBlockDetail,
  missingAirplayComponents,
} from "./airplayCapability";

describe("AirPlay capability diagnostics", () => {
  it("uses a player limitation only when every blocked display agrees", () => {
    expect(
      airplayCapabilityBlockDetail([
        { airplayLimitation: "UxPlay is missing." } as ReliabilityStatus,
        { airplayLimitation: "UxPlay is missing." } as ReliabilityStatus,
      ]),
    ).toBe("UxPlay is missing.");

    expect(
      airplayCapabilityBlockDetail([
        { airplayLimitation: "UxPlay is missing." } as ReliabilityStatus,
        { airplayLimitation: "Avahi is unavailable." } as ReliabilityStatus,
      ]),
    ).toContain("/install-airplay.sh");
  });

  it("falls back to reported component flags for older players", () => {
    expect(
      missingAirplayComponents([
        { airplayUxPlayInstalled: false, airplayGstreamerInstalled: false },
      ] as ReliabilityStatus[]),
    ).toBe(
      "Missing UxPlay and GStreamer. Run the server's /install-airplay.sh installer as root.",
    );
  });
});
