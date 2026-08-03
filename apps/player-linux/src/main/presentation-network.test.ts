import { describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { StateStore } from "../core/storage";
import {
  PresentationNetworkError,
  parsePresentationNetworkAssignment,
  type PresentationNetworkCapability,
  type PresentationNetworkProvisioning,
} from "../core/presentation-network";
import {
  PresentationNetworkManager,
  isWirelessInterfaceName,
} from "./presentation-network";

const NETWORK_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ID = "8f14e45f-ceea-467a-9575-6a1a0a1a0a1a";
const PSK = "test-only-presentation-psk-2026";

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

function assignment(overrides: Record<string, unknown> = {}) {
  return parsePresentationNetworkAssignment({
    ...assignmentSection,
    ...overrides,
  })!;
}

/**
 * A fake root helper. It records every call so the tests can assert on ordering,
 * on which connection was named, and on what was never done — the last of which is
 * where most of the safety properties live.
 */
class FakeHelper {
  calls: string[] = [];
  capability: PresentationNetworkCapability = {
    supported: true,
    helperState: "ok",
    networkManagerAvailable: true,
    wifiAdapter: true,
    radioEnabled: true,
    wiredInterfaceAvailable: true,
    wiredIpv4: "10.10.2.15",
    defaultRouteInterface: "eth0",
    activeNetworkId: "",
    installedProfiles: [],
  };
  activation = {
    ipv4: "10.40.5.71",
    radioWasEnabled: true,
    defaultRouteInterface: "eth0",
    wiredIpv4: "10.10.2.15",
  };
  activateError: PresentationNetworkError | null = null;
  installError: PresentationNetworkError | null = null;
  installed: PresentationNetworkProvisioning[] = [];
  deactivated: { networkId: string; restoreRadioDisabled: boolean }[] = [];
  deleted: string[] = [];

  async status(): Promise<PresentationNetworkCapability> {
    this.calls.push("status");
    return {
      ...this.capability,
      installedProfiles: [...this.capability.installedProfiles],
    };
  }

  async install(material: PresentationNetworkProvisioning): Promise<void> {
    this.calls.push(`install:${material.presentationNetworkId}`);
    if (this.installError) throw this.installError;
    // Model NetworkManager accepting it: the profile becomes visible to status.
    this.installed.push({ ...material });
    this.capability = {
      ...this.capability,
      installedProfiles: [
        ...this.capability.installedProfiles.filter(
          (item) => item.networkId !== material.presentationNetworkId,
        ),
        {
          networkId: material.presentationNetworkId,
          revision: material.configRevision,
        },
      ],
    };
  }

  async activate(networkId: string) {
    this.calls.push(`activate:${networkId}`);
    if (this.activateError) throw this.activateError;
    this.capability = { ...this.capability, activeNetworkId: networkId };
    return { ...this.activation };
  }

  async deactivate(
    networkId: string,
    restoreRadioDisabled: boolean,
  ): Promise<void> {
    this.calls.push(`deactivate:${networkId}:${restoreRadioDisabled}`);
    this.deactivated.push({ networkId, restoreRadioDisabled });
    this.capability = { ...this.capability, activeNetworkId: "" };
  }

  async delete(networkId: string): Promise<void> {
    this.calls.push(`delete:${networkId}`);
    this.deleted.push(networkId);
    this.capability = {
      ...this.capability,
      installedProfiles: this.capability.installedProfiles.filter(
        (item) => item.networkId !== networkId,
      ),
    };
  }
}

function material(
  overrides: Partial<PresentationNetworkProvisioning> = {},
): PresentationNetworkProvisioning {
  return {
    presentationNetworkId: NETWORK_ID,
    name: "District Staff Wi-Fi",
    ssid: "District-Staff",
    hidden: false,
    security: "wpa_psk",
    configRevision: 3,
    profileName: `tilecast-presentation-${NETWORK_ID}`,
    identity: "",
    anonymousIdentity: "",
    domainSuffixMatch: "",
    secret: PSK,
    caCertificatePem: "",
    ...overrides,
  };
}

async function build(
  options: {
    helper?: FakeHelper;
    provisioning?: () => Promise<PresentationNetworkProvisioning>;
  } = {},
) {
  const store = new StateStore(mkdtempSync(join(tmpdir(), "tilecast-pn-")));
  await store.init();
  const helper = options.helper ?? new FakeHelper();
  const fetchProvisioning = options.provisioning ?? (async () => material());
  const manager = new PresentationNetworkManager({
    store,
    helper: helper as never,
    fetchProvisioning,
  });
  return { store, helper, manager };
}

describe("presentation network capability", () => {
  it("reports unsupported when NetworkManager is unavailable, and does nothing else", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      networkManagerAvailable: false,
      supported: false,
      helperState: "unsupported",
      limitation: "NetworkManager is not running.",
    };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    const status = manager.getStatus();
    expect(status.state).toBe("unsupported");
    expect(status.failureCode).toBe("network_manager_unavailable");
    // Nothing is provisioned, activated, or deleted on a box that cannot manage
    // connections at all.
    expect(helper.installed).toHaveLength(0);
    expect(helper.deleted).toHaveLength(0);
    expect(
      helper.calls.filter((call) => call.startsWith("activate")),
    ).toHaveLength(0);
  });

  it("reports a missing helper as its own failure", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      networkManagerAvailable: false,
      supported: false,
      helperState: "missing",
      limitation: "The helper is not installed.",
    };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    expect(manager.getStatus().failureCode).toBe("helper_unavailable");
  });

  it("reports no Wi-Fi adapter without attempting to provision", async () => {
    const helper = new FakeHelper();
    helper.capability = { ...helper.capability, wifiAdapter: false };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    const status = manager.getStatus();
    expect(status.state).toBe("failed");
    expect(status.failureCode).toBe("wifi_adapter_unavailable");
    expect(helper.installed).toHaveLength(0);
  });
});

describe("provisioning and reconciliation", () => {
  it("installs the profile and reports it provisioned", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    expect(manager.getStatus().state).toBe("provisioned");
    expect(helper.installed.map((item) => item.presentationNetworkId)).toEqual([
      NETWORK_ID,
    ]);
  });

  it("does not fetch the credential again when the profile is current", async () => {
    const helper = new FakeHelper();
    const fetches = vi.fn(async () => material());
    const { manager } = await build({ helper, provisioning: fetches });
    await manager.applyAssignment(assignment());
    expect(fetches).toHaveBeenCalledTimes(1);
    await manager.reconcile();
    await manager.reconcile();
    // A current profile costs a status call and no credential movement, which is
    // what keeps a later AirPlay session fast.
    expect(fetches).toHaveBeenCalledTimes(1);
  });

  it("replaces a stale profile when the credential rotates", async () => {
    const helper = new FakeHelper();
    const { manager } = await build({
      helper,
      provisioning: async () => material({ configRevision: 4 }),
    });
    helper.capability = {
      ...helper.capability,
      installedProfiles: [{ networkId: NETWORK_ID, revision: 3 }],
    };
    await manager.applyAssignment(assignment({ configRevision: 4 }));
    expect(helper.installed.map((item) => item.configRevision)).toEqual([4]);
    expect(manager.getStatus().installedRevision).toBe(4);
  });

  it("deletes an obsolete profile when the assignment moves to another network", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      installedProfiles: [{ networkId: OTHER_ID, revision: 1 }],
    };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    expect(helper.deleted).toEqual([OTHER_ID]);
  });

  it("deletes every Tilecast profile when the assignment is removed", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      installedProfiles: [
        { networkId: NETWORK_ID, revision: 3 },
        { networkId: OTHER_ID, revision: 1 },
      ],
    };
    const { manager } = await build({ helper });
    // This is the offline case: the desired state is durable configuration, so an
    // unassignment converges on the next sync without needing a command.
    await manager.applyAssignment(null);
    expect(helper.deleted.sort()).toEqual([NETWORK_ID, OTHER_ID].sort());
    expect(manager.getStatus().state).toBe("unassigned");
  });

  it("reports a credential the server cannot produce without attempting a fetch", async () => {
    const fetches = vi.fn(async () => material());
    const { manager } = await build({ provisioning: fetches });
    await manager.applyAssignment(assignment({ credentialAvailable: false }));
    expect(fetches).not.toHaveBeenCalled();
    expect(manager.getStatus().failureCode).toBe("credential_unavailable");
  });

  it("reports a credential fetch failure without quoting anything from it", async () => {
    const { manager } = await build({
      provisioning: async () => {
        throw new Error(
          "The stored Presentation Network credential cannot be decrypted with the configured key.",
        );
      },
    });
    await manager.applyAssignment(assignment());
    const status = manager.getStatus();
    expect(status.failureCode).toBe("credential_unavailable");
    expect(status.failureMessage).toMatch(/cannot be decrypted/);
    expect(status.failureMessage).not.toContain(PSK);
  });

  it("drops provisioning material for a network the assignment no longer names", async () => {
    const helper = new FakeHelper();
    const { manager } = await build({
      helper,
      provisioning: async () => material({ presentationNetworkId: OTHER_ID }),
    });
    await manager.applyAssignment(assignment());
    expect(helper.installed).toHaveLength(0);
    expect(manager.getStatus().state).toBe("pending");
  });
});

describe("session activation", () => {
  it("joins the network and reports connected", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    const status = await manager.connect("airplay:test");
    expect(status.state).toBe("connected");
    expect(status.activeNetworkId).toBe(NETWORK_ID);
    expect(helper.calls).toContain(`activate:${NETWORK_ID}`);
  });

  it("never touches a network for a screen with no assignment", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(null);
    const status = await manager.connect("airplay:test");
    // A screen with no assignment keeps the existing Ethernet-only AirPlay
    // behavior, so connect() is a no-op rather than an error.
    expect(status.state).toBe("unassigned");
    expect(
      helper.calls.filter((call) => call.startsWith("activate")),
    ).toHaveLength(0);
  });

  it("fails the session when the network cannot authenticate", async () => {
    const helper = new FakeHelper();
    helper.activateError = new PresentationNetworkError(
      "authentication_failed",
      "Authentication failed.",
    );
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await expect(manager.connect("airplay:test")).rejects.toMatchObject({
      code: "authentication_failed",
    });
    const status = manager.getStatus();
    expect(status.state).toBe("failed");
    expect(status.lastFailureAt).toBeTruthy();
  });

  it("tears the connection down when no address arrives", async () => {
    const helper = new FakeHelper();
    helper.activation = { ...helper.activation, ipv4: "" };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await expect(manager.connect("airplay:test")).rejects.toMatchObject({
      code: "dhcp_timeout",
    });
    expect(helper.deactivated.map((item) => item.networkId)).toContain(
      NETWORK_ID,
    );
  });

  it("tears the connection down when the sidecar captures the default route", async () => {
    // This is the invariant the whole feature rests on. A Wi-Fi connection that
    // became the default route would carry this player's own Tilecast traffic out
    // over the presentation VLAN, so it is disconnected rather than tolerated.
    const helper = new FakeHelper();
    helper.activation = {
      ...helper.activation,
      defaultRouteInterface: "wlan0",
    };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await expect(manager.connect("airplay:test")).rejects.toMatchObject({
      code: "ethernet_default_route_lost",
    });
    expect(helper.deactivated.map((item) => item.networkId)).toContain(
      NETWORK_ID,
    );
    expect(manager.getStatus().state).toBe("failed");
  });

  it("tears the connection down when Ethernet disappears during preparation", async () => {
    const helper = new FakeHelper();
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    const original = helper.status.bind(helper);
    let calls = 0;
    helper.status = async () => {
      calls += 1;
      const capability = await original();
      // The verification read after activation sees Ethernet gone.
      // Reconciliation reads status twice, then activation happens, then the
      // sidecar verification reads it a third time. Ethernet is gone by then.
      return calls >= 3
        ? { ...capability, wiredInterfaceAvailable: false, wiredIpv4: "" }
        : capability;
    };
    await expect(manager.connect("airplay:test")).rejects.toMatchObject({
      code: "ethernet_default_route_lost",
    });
    expect(helper.deactivated.map((item) => item.networkId)).toContain(
      NETWORK_ID,
    );
  });

  it("refuses to connect when the network is not ready", async () => {
    const helper = new FakeHelper();
    helper.capability = { ...helper.capability, wifiAdapter: false };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await expect(manager.connect("airplay:test")).rejects.toMatchObject({
      code: "wifi_adapter_unavailable",
    });
  });

  it("provisions a stale profile before joining rather than failing on the old credential", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      installedProfiles: [{ networkId: NETWORK_ID, revision: 2 }],
    };
    const { manager } = await build({
      helper,
      provisioning: async () => material({ configRevision: 3 }),
    });
    await manager.applyAssignment(assignment({ configRevision: 3 }));
    await manager.connect("airplay:test");
    // Install must precede activation, or the session authenticates with the
    // password that was just rotated away.
    const installIndex = helper.calls.indexOf(`install:${NETWORK_ID}`);
    const activateIndex = helper.calls.indexOf(`activate:${NETWORK_ID}`);
    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(activateIndex).toBeGreaterThan(installIndex);
  });
});

describe("radio lifecycle and teardown", () => {
  it("leaves an already-enabled radio enabled after the session", async () => {
    const helper = new FakeHelper();
    helper.activation = { ...helper.activation, radioWasEnabled: true };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await manager.connect("airplay:test");
    await manager.disconnect("airplay_stopped");
    expect(helper.deactivated).toEqual([
      { networkId: NETWORK_ID, restoreRadioDisabled: false },
    ]);
  });

  it("restores a radio Tilecast had to enable", async () => {
    const helper = new FakeHelper();
    helper.activation = { ...helper.activation, radioWasEnabled: false };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await manager.connect("airplay:test");
    await manager.disconnect("airplay_stopped");
    expect(helper.deactivated).toEqual([
      { networkId: NETWORK_ID, restoreRadioDisabled: true },
    ]);
  });

  it("keeps the provisioned profile after a session so the next one is fast", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    await manager.connect("airplay:test");
    await manager.disconnect("airplay_stopped");
    expect(helper.deleted).toHaveLength(0);
    expect(helper.capability.installedProfiles).toEqual([
      { networkId: NETWORK_ID, revision: 3 },
    ]);
    expect(manager.getStatus().state).toBe("provisioned");
  });

  it("makes teardown idempotent", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    await manager.connect("airplay:test");
    await manager.disconnect("first");
    await manager.disconnect("second");
    await manager.disconnect("third");
    expect(helper.deactivated).toHaveLength(1);
  });

  it("disconnecting with nothing connected is a no-op", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    await manager.disconnect("never_connected");
    expect(helper.deactivated).toHaveLength(0);
  });
});

describe("restart recovery", () => {
  it("cleans up a connection a crash left behind", async () => {
    const helper = new FakeHelper();
    helper.capability = { ...helper.capability, activeNetworkId: NETWORK_ID };
    const { manager } = await build({ helper });
    await manager.applyAssignment(assignment());
    await manager.cleanupOrphaned();
    expect(helper.deactivated.map((item) => item.networkId)).toEqual([
      NETWORK_ID,
    ]);
  });

  it("does nothing when no Tilecast connection is up", async () => {
    const { manager, helper } = await build();
    await manager.applyAssignment(assignment());
    await manager.cleanupOrphaned();
    expect(helper.deactivated).toHaveLength(0);
  });

  it("does not clean up when NetworkManager is unavailable", async () => {
    const helper = new FakeHelper();
    helper.capability = {
      ...helper.capability,
      networkManagerAvailable: false,
      activeNetworkId: NETWORK_ID,
    };
    const { manager } = await build({ helper });
    await manager.cleanupOrphaned();
    expect(helper.deactivated).toHaveLength(0);
  });

  it("remembers the prior radio state across a restart", async () => {
    const store = new StateStore(
      mkdtempSync(join(tmpdir(), "tilecast-pn-restart-")),
    );
    await store.init();
    const first = new FakeHelper();
    first.activation = { ...first.activation, radioWasEnabled: false };
    const before = new PresentationNetworkManager({
      store,
      helper: first as never,
      fetchProvisioning: async () => material(),
    });
    await before.applyAssignment(assignment());
    await before.connect("airplay:test");

    // A new process reads the persisted state. Without it, the player could not
    // tell "Tilecast enabled this radio" from "the operator did", and would either
    // leave a radio on forever or silently disable an operator's Wi-Fi.
    const second = new FakeHelper();
    second.capability = { ...second.capability, activeNetworkId: NETWORK_ID };
    const after = new PresentationNetworkManager({
      store,
      helper: second as never,
      fetchProvisioning: async () => material(),
    });
    await after.cleanupOrphaned();
    expect(second.deactivated).toEqual([
      { networkId: NETWORK_ID, restoreRadioDisabled: true },
    ]);
  });

  it("never persists the credential", async () => {
    const store = new StateStore(
      mkdtempSync(join(tmpdir(), "tilecast-pn-secret-")),
    );
    await store.init();
    const manager = new PresentationNetworkManager({
      store,
      helper: new FakeHelper() as never,
      fetchProvisioning: async () => material(),
    });
    await manager.applyAssignment(assignment());
    await manager.connect("airplay:test");
    const persisted = await store.readJson<Record<string, unknown>>(
      "presentation-network.json",
    );
    expect(persisted).not.toBeNull();
    expect(JSON.stringify(persisted)).not.toContain(PSK);
    expect(JSON.stringify(persisted)).not.toContain("psk");
    expect(JSON.stringify(persisted)).not.toContain("secret");
    expect(JSON.stringify(persisted)).not.toContain("password");
    // Only the two facts that must survive a restart.
    expect(Object.keys(persisted!).sort()).toEqual([
      "activeNetworkId",
      "radioWasEnabled",
      "version",
    ]);
  });

  it("defaults to leaving the radio alone when the state file is unreadable", async () => {
    const store = new StateStore(
      mkdtempSync(join(tmpdir(), "tilecast-pn-bad-")),
    );
    await store.init();
    await store.writeJson("presentation-network.json", {
      version: 99,
      radioWasEnabled: false,
    });
    const helper = new FakeHelper();
    helper.capability = { ...helper.capability, activeNetworkId: NETWORK_ID };
    const manager = new PresentationNetworkManager({
      store,
      helper: helper as never,
      fetchProvisioning: async () => material(),
    });
    await manager.cleanupOrphaned();
    // Leaving a radio enabled is recoverable; silently disabling an operator's
    // Wi-Fi is not, so an unrecognized file takes the conservative direction.
    expect(helper.deactivated).toEqual([
      { networkId: NETWORK_ID, restoreRadioDisabled: false },
    ]);
  });
});

describe("interface classification", () => {
  it("recognizes wireless interface names", () => {
    for (const name of ["wlan0", "wlp3s0", "wl0", "ath0", "ra0"]) {
      expect(isWirelessInterfaceName(name), name).toBe(true);
    }
    for (const name of ["eth0", "eno1", "enp0s25", "ens33", "lo", "docker0"]) {
      expect(isWirelessInterfaceName(name), name).toBe(false);
    }
  });
});
