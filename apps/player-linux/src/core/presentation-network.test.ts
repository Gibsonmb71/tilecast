import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import type { Socket } from "net";
import {
  ACTIVATION_TIMEOUT_MS,
  PresentationNetworkError,
  PresentationNetworkHelperClient,
  activationFailureCode,
  obsoleteProfiles,
  parsePresentationNetworkAssignment,
  parsePresentationNetworkProvisioning,
  presentationNetworkProfileName,
  profileNeedsProvisioning,
  validIpv4,
} from "./presentation-network";

const NETWORK_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ID = "8f14e45f-ceea-467a-9575-6a1a0a1a0a1a";
const PSK = "test-only-presentation-psk-2026";

/**
 * A fake unix socket that answers one request. It records exactly what was
 * written, which is how the tests assert that a credential travels over the
 * socket and never anywhere else.
 */
function fakeHelper(response: unknown, options: { silent?: boolean } = {}) {
  const written: string[] = [];
  const connect = () => {
    const socket = new EventEmitter() as unknown as Socket & {
      write: (chunk: string) => boolean;
    };
    socket.setEncoding = (() => socket) as Socket["setEncoding"];
    socket.destroy = (() => socket) as Socket["destroy"];
    socket.write = (chunk: string) => {
      written.push(chunk);
      if (!options.silent) {
        setImmediate(() =>
          socket.emit("data", `${JSON.stringify(response)}\n`),
        );
      }
      return true;
    };
    setImmediate(() => socket.emit("connect"));
    return socket;
  };
  return {
    written,
    client: new PresentationNetworkHelperClient({
      socketPath: "/tmp/does-not-exist.sock",
      connect: connect as never,
    }),
  };
}

const statusResponse = {
  ok: true,
  networkManagerAvailable: true,
  wifiAdapter: true,
  radioEnabled: true,
  wiredInterfaceAvailable: true,
  wiredIpv4: "10.10.2.15",
  defaultRouteInterface: "eth0",
  activeNetworkId: "",
  profiles: [{ networkId: NETWORK_ID, revision: 3 }],
};

const assignmentSection = {
  assigned: true,
  presentationNetworkId: NETWORK_ID,
  name: "District Staff Wi-Fi",
  ssid: "District-Staff",
  hidden: false,
  security: "wpa_psk",
  configRevision: 3,
  credentialAvailable: true,
  identity: "",
  anonymousIdentity: "",
  domainSuffixMatch: "",
  caCertificateSet: false,
};

describe("presentation network configuration parsing", () => {
  it("decodes an assignment and derives the namespaced profile name", () => {
    const assignment = parsePresentationNetworkAssignment(assignmentSection);
    expect(assignment).not.toBeNull();
    expect(assignment!.presentationNetworkId).toBe(NETWORK_ID);
    expect(assignment!.configRevision).toBe(3);
    expect(assignment!.profileName).toBe(`tilecast-presentation-${NETWORK_ID}`);
  });

  it("treats an explicit 'not assigned' section as no assignment", () => {
    // This is the instruction that removes an obsolete profile from a player that
    // was offline when the assignment changed, so it must decode cleanly to null
    // rather than throwing.
    expect(parsePresentationNetworkAssignment({ assigned: false })).toBeNull();
  });

  it("rejects an unsupported authentication type rather than coercing it", () => {
    expect(() =>
      parsePresentationNetworkAssignment({
        ...assignmentSection,
        security: "wpa_eap_tls",
      }),
    ).toThrow(/authentication type/i);
  });

  it("rejects a malformed identifier, SSID, or revision", () => {
    expect(() =>
      parsePresentationNetworkAssignment({
        ...assignmentSection,
        presentationNetworkId: "wlan0",
      }),
    ).toThrow(/ID is invalid/i);
    expect(() =>
      parsePresentationNetworkAssignment({ ...assignmentSection, ssid: "" }),
    ).toThrow(/SSID/i);
    expect(() =>
      parsePresentationNetworkAssignment({
        ...assignmentSection,
        ssid: "x".repeat(33),
      }),
    ).toThrow(/SSID/i);
    expect(() =>
      parsePresentationNetworkAssignment({
        ...assignmentSection,
        configRevision: 0,
      }),
    ).toThrow(/revision/i);
  });

  it("decodes provisioning material with its nested 802.1X metadata", () => {
    const material = parsePresentationNetworkProvisioning({
      presentationNetworkId: NETWORK_ID,
      name: "District Staff Wi-Fi",
      ssid: "District-Staff",
      hidden: true,
      security: "wpa_eap_peap_mschapv2",
      configRevision: 4,
      secret: "test-only-radius-secret",
      auth: {
        identity: "svc-signage@district.example.org",
        anonymousIdentity: "anonymous@district.example.org",
        caCertificatePem:
          "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----",
        domainSuffixMatch: "radius.district.example.org",
      },
    });
    expect(material.identity).toBe("svc-signage@district.example.org");
    expect(material.domainSuffixMatch).toBe("radius.district.example.org");
    expect(material.caCertificatePem).toContain("BEGIN CERTIFICATE");
    expect(material.secret).toBe("test-only-radius-secret");
  });

  it("rejects provisioning material with no usable credential", () => {
    // The message must describe the rule, never the value.
    for (const secret of ["", "x".repeat(129), 42, null]) {
      expect(() =>
        parsePresentationNetworkProvisioning({
          ...assignmentSection,
          secret,
        }),
      ).toThrow(/credential is invalid/i);
    }
  });
});

describe("wired IPv4 validation", () => {
  it("accepts an ordinary LAN address", () => {
    expect(validIpv4("10.10.2.15")).toBe(true);
    expect(validIpv4("192.168.1.40")).toBe(true);
    expect(validIpv4("172.16.9.3")).toBe(true);
  });

  it("rejects every address that cannot be a group RTP destination", () => {
    // Each of these is something a dual-homed box can plausibly hold, and none of
    // them is reachable from another display.
    for (const candidate of [
      "0.0.0.0",
      "127.0.0.1",
      "169.254.7.7",
      "239.255.42.1",
      "255.255.255.255",
      "10.10.2",
      "10.10.2.256",
      "10.10.2.15/24",
      "::1",
      "",
      "not-an-address",
    ]) {
      expect(validIpv4(candidate), candidate).toBe(false);
    }
  });
});

describe("profile reconciliation", () => {
  it("provisions when no profile is installed", () => {
    const assignment = parsePresentationNetworkAssignment(assignmentSection)!;
    expect(profileNeedsProvisioning(assignment, [])).toBe(true);
  });

  it("replaces a profile whose revision is stale", () => {
    // A stale revision means the credential rotated or the SSID changed. Reusing
    // it would authenticate with the old password next time the room presents.
    const assignment = parsePresentationNetworkAssignment(assignmentSection)!;
    expect(
      profileNeedsProvisioning(assignment, [
        { networkId: NETWORK_ID, revision: 2 },
      ]),
    ).toBe(true);
    expect(
      profileNeedsProvisioning(assignment, [
        { networkId: NETWORK_ID, revision: 0 },
      ]),
    ).toBe(true);
  });

  it("leaves a current profile alone so the next session is fast", () => {
    const assignment = parsePresentationNetworkAssignment(assignmentSection)!;
    expect(
      profileNeedsProvisioning(assignment, [
        { networkId: NETWORK_ID, revision: 3 },
      ]),
    ).toBe(false);
  });

  it("marks every non-assigned Tilecast profile obsolete", () => {
    const assignment = parsePresentationNetworkAssignment(assignmentSection)!;
    expect(
      obsoleteProfiles(assignment, [
        { networkId: NETWORK_ID, revision: 3 },
        { networkId: OTHER_ID, revision: 1 },
      ]),
    ).toEqual([OTHER_ID]);
  });

  it("marks every Tilecast profile obsolete when nothing is assigned", () => {
    expect(
      obsoleteProfiles(null, [
        { networkId: NETWORK_ID, revision: 3 },
        { networkId: OTHER_ID, revision: 1 },
      ]),
    ).toEqual([NETWORK_ID, OTHER_ID]);
  });
});

describe("helper client", () => {
  it("reports capability from a status response", async () => {
    const { client } = fakeHelper(statusResponse);
    const capability = await client.status();
    expect(capability.supported).toBe(true);
    expect(capability.helperState).toBe("ok");
    expect(capability.wifiAdapter).toBe(true);
    expect(capability.wiredIpv4).toBe("10.10.2.15");
    expect(capability.installedProfiles).toEqual([
      { networkId: NETWORK_ID, revision: 3 },
    ]);
  });

  it("reports a missing helper rather than guessing", async () => {
    const client = new PresentationNetworkHelperClient({
      socketPath: "/tmp/nope.sock",
      connect: (() => {
        const error = new Error("connect ENOENT") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      }) as never,
    });
    const capability = await client.status();
    expect(capability.supported).toBe(false);
    expect(capability.helperState).toBe("missing");
    expect(capability.limitation).toMatch(/not installed/i);
  });

  it("reports an unhealthy helper when the response is not ok", async () => {
    const { client } = fakeHelper({ ok: false, code: "helper_error" });
    const capability = await client.status();
    expect(capability.supported).toBe(false);
    expect(capability.helperState).toBe("unhealthy");
  });

  it("reports no Wi-Fi adapter separately from no NetworkManager", async () => {
    const { client } = fakeHelper({
      ...statusResponse,
      wifiAdapter: false,
      limitation: "This player has no usable Wi-Fi adapter.",
    });
    const capability = await client.status();
    // NetworkManager works, so this is a hardware fact and not a provisioning
    // problem — two entirely different fixes for an operator.
    expect(capability.networkManagerAvailable).toBe(true);
    expect(capability.wifiAdapter).toBe(false);
    expect(capability.limitation).toMatch(/Wi-Fi adapter/);
  });

  it("discards an unmanaged installed profile identifier", async () => {
    const { client } = fakeHelper({
      ...statusResponse,
      profiles: [
        { networkId: "not-a-uuid", revision: 1 },
        { networkId: NETWORK_ID },
      ],
    });
    const capability = await client.status();
    expect(capability.installedProfiles).toEqual([
      { networkId: NETWORK_ID, revision: 0 },
    ]);
  });

  it("sends the credential over the socket and never in an argument", async () => {
    const { client, written } = fakeHelper({ ok: true });
    await client.install({
      presentationNetworkId: NETWORK_ID,
      name: "District Staff Wi-Fi",
      ssid: "District-Staff",
      hidden: false,
      security: "wpa_psk",
      configRevision: 3,
      profileName: presentationNetworkProfileName(NETWORK_ID),
      identity: "",
      anonymousIdentity: "",
      domainSuffixMatch: "",
      secret: PSK,
      caCertificatePem: "",
    });
    expect(written).toHaveLength(1);
    const request = JSON.parse(written[0]!.trim()) as Record<string, unknown>;
    expect(request["op"]).toBe("install");
    expect(request["secret"]).toBe(PSK);
    expect(request["revision"]).toBe(3);
  });

  it("turns an install failure into a typed error", async () => {
    const { client } = fakeHelper({
      ok: false,
      code: "invalid_ssid",
      message: "ssid is invalid",
    });
    await expect(
      client.install({
        presentationNetworkId: NETWORK_ID,
        name: "n",
        ssid: "x",
        hidden: false,
        security: "wpa_psk",
        configRevision: 1,
        profileName: presentationNetworkProfileName(NETWORK_ID),
        identity: "",
        anonymousIdentity: "",
        domainSuffixMatch: "",
        secret: PSK,
        caCertificatePem: "",
      }),
    ).rejects.toBeInstanceOf(PresentationNetworkError);
  });

  it("returns the activation facts the caller has to verify", async () => {
    const { client } = fakeHelper({
      ok: true,
      ipv4: "10.40.5.71",
      radioWasEnabled: false,
      defaultRouteInterface: "eth0",
      wiredIpv4: "10.10.2.15",
    });
    const activation = await client.activate(NETWORK_ID);
    expect(activation.ipv4).toBe("10.40.5.71");
    expect(activation.radioWasEnabled).toBe(false);
    expect(activation.defaultRouteInterface).toBe("eth0");
  });

  it("maps helper failure codes onto the player's stable set", async () => {
    for (const [code, expected] of [
      ["authentication_failed", "authentication_failed"],
      ["ssid_not_found", "ssid_not_found"],
      ["dhcp_timeout", "dhcp_timeout"],
      ["radio_unavailable", "radio_unavailable"],
      ["profile_missing", "profile_install_failed"],
      ["something_new", "activation_failed"],
    ] as const) {
      const { client } = fakeHelper({ ok: false, code, message: "failed" });
      await expect(client.activate(NETWORK_ID)).rejects.toMatchObject({
        code: expected,
      });
    }
  });

  it("does not pass an unknown code through to Studio", () => {
    expect(activationFailureCode("totally_unknown")).toBe("activation_failed");
    expect(activationFailureCode(undefined)).toBe("activation_failed");
    expect(activationFailureCode(7)).toBe("activation_failed");
  });

  it("bounds the activation request and its own wait", async () => {
    const { client, written } = fakeHelper({ ok: true, ipv4: "10.40.5.71" });
    await client.activate(NETWORK_ID, ACTIVATION_TIMEOUT_MS);
    const request = JSON.parse(written[0]!.trim()) as Record<string, unknown>;
    // The helper gets its own budget, clamped to what it accepts.
    expect(request["timeoutSeconds"]).toBe(75);
  });

  it("gives up rather than hanging when the helper never answers", async () => {
    vi.useFakeTimers();
    try {
      const { client } = fakeHelper({}, { silent: true });
      const pending = client.status();
      await vi.advanceTimersByTimeAsync(31_000);
      const capability = await pending;
      expect(capability.helperState).toBe("unhealthy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws from cleanup, so teardown stays idempotent", async () => {
    const { client } = fakeHelper({ ok: false, code: "helper_error" });
    await expect(client.deactivate(NETWORK_ID, true)).resolves.toBeUndefined();
    await expect(client.delete(NETWORK_ID)).resolves.toBeUndefined();
  });
});
