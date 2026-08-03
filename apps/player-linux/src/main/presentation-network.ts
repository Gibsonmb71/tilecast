/**
 * Linux Presentation Network manager.
 *
 * Owns the local lifecycle of the temporary Wi-Fi connection AirPlay uses when a
 * Presentation Network is assigned: reconciling provisioned NetworkManager
 * profiles against the server's desired state, activating one for a session,
 * verifying it is a usable *sidecar*, and tearing it down cleanly afterwards.
 *
 * The invariant this module exists to hold: Ethernet stays the default route and
 * keeps carrying Tilecast server traffic, commands, heartbeats, downloads, and
 * group AirPlay RTP fan-out. The Wi-Fi connection exists only so senders on that
 * VLAN can discover and reach UxPlay. If Ethernet ever stops being the default
 * route, the Wi-Fi connection is torn down rather than tolerated.
 *
 * Two things it deliberately does not do:
 *  - It never persists the Wi-Fi credential. Not in its own state file, not in
 *    `airplay-session.json`, not in a log line. The credential is fetched from
 *    the server only when a profile must actually be installed, and it lives in
 *    memory for the length of that one helper call.
 *  - It never turns the Wi-Fi radio off unless Tilecast is the reason it came on.
 *    A machine whose Wi-Fi was already enabled keeps it enabled, and an unrelated
 *    Wi-Fi connection is never disconnected.
 */

import { logger } from "../core/log";
import {
  ACTIVATION_TIMEOUT_MS,
  PresentationNetworkError,
  PresentationNetworkHelperClient,
  obsoleteProfiles,
  profileNeedsProvisioning,
  unsupportedPresentationNetworkCapability,
  validIpv4,
  type PresentationNetworkAssignment,
  type PresentationNetworkCapability,
  type PresentationNetworkFailureCode,
  type PresentationNetworkProvisioning,
  type PresentationNetworkState,
} from "../core/presentation-network";
import type { StateStore } from "../core/storage";

const log = logger("presentation-network");

const STATE_FILE = "presentation-network.json";
const STATE_FORMAT = 1;

/**
 * Local state that has to survive a restart.
 *
 * `radioWasEnabled` is the whole reason this file exists. It records whether the
 * Wi-Fi radio was already on before Tilecast activated a connection, which is what
 * decides whether Tilecast may turn it back off. A crash between activation and
 * teardown would otherwise leave the player unable to tell "I enabled this radio"
 * from "the operator did", and the safe-but-wrong answer in either direction is
 * either a radio left on forever or an operator's Wi-Fi silently disabled.
 *
 * There is deliberately no credential field, and a test asserts that.
 */
interface PersistedPresentationNetworkState {
  version: number;
  /** The network whose connection Tilecast currently has up, if any. */
  activeNetworkId: string | null;
  /** Whether the radio was already enabled before Tilecast activated it. */
  radioWasEnabled: boolean;
}

export interface PresentationNetworkStatus {
  state: PresentationNetworkState;
  /** Display name, for Studio progress copy. Never the SSID's credential. */
  networkName: string;
  networkId: string | null;
  activeNetworkId: string | null;
  installedNetworkId: string | null;
  installedRevision: number | null;
  failureCode?: PresentationNetworkFailureCode;
  failureMessage?: string;
  lastConnectedAt?: string;
  lastFailureAt?: string;
}

export interface PresentationNetworkManagerOptions {
  store: StateStore;
  /** Fetches provisioning material over the authenticated player channel. */
  fetchProvisioning: () => Promise<PresentationNetworkProvisioning>;
  helper?: PresentationNetworkHelperClient;
  now?: () => number;
  onStatus?: (status: PresentationNetworkStatus) => void;
}

export class PresentationNetworkManager {
  private readonly store: StateStore;
  private readonly helper: PresentationNetworkHelperClient;
  private readonly fetchProvisioning: () => Promise<PresentationNetworkProvisioning>;
  private readonly now: () => number;
  private readonly onStatus?: (status: PresentationNetworkStatus) => void;

  private assignment: PresentationNetworkAssignment | null = null;
  private capability: PresentationNetworkCapability | null = null;
  private persisted: PersistedPresentationNetworkState = {
    version: STATE_FORMAT,
    activeNetworkId: null,
    radioWasEnabled: true,
  };
  private loaded = false;
  private status: PresentationNetworkStatus = {
    state: "unassigned",
    networkName: "",
    networkId: null,
    activeNetworkId: null,
    installedNetworkId: null,
    installedRevision: null,
  };
  /** Serializes every helper interaction; two activations must never race. */
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: PresentationNetworkManagerOptions) {
    this.store = options.store;
    this.helper = options.helper ?? new PresentationNetworkHelperClient();
    this.fetchProvisioning = options.fetchProvisioning;
    this.now = options.now ?? Date.now;
    this.onStatus = options.onStatus;
  }

  /**
   * Apply the assignment from configuration synchronization.
   *
   * `null` means "no Presentation Network assigned", which is an instruction to
   * remove any Tilecast-managed profile this player still holds — not a no-op.
   * That is how an assignment change reaches a player that was offline when it
   * happened, and it converges rather than depending on an event.
   */
  async applyAssignment(
    assignment: PresentationNetworkAssignment | null,
  ): Promise<void> {
    const changed =
      this.assignment?.presentationNetworkId !==
        assignment?.presentationNetworkId ||
      this.assignment?.configRevision !== assignment?.configRevision;
    this.assignment = assignment;
    if (changed) {
      log.info("presentation network assignment applied", {
        // Identifier and revision only. The SSID is not secret, but there is no
        // reason for it to be in a log line either.
        networkId: assignment?.presentationNetworkId ?? null,
        revision: assignment?.configRevision ?? null,
      });
    }
    await this.reconcile();
  }

  getAssignment(): PresentationNetworkAssignment | null {
    return this.assignment ? { ...this.assignment } : null;
  }

  getStatus(): PresentationNetworkStatus {
    return { ...this.status };
  }

  getCapability(): PresentationNetworkCapability | null {
    return this.capability ? { ...this.capability } : null;
  }

  /** Probe capability. Cheap enough for the reporting cadence: one socket call. */
  async probe(): Promise<PresentationNetworkCapability> {
    this.capability = await this.helper.status();
    this.publish();
    return { ...this.capability };
  }

  /**
   * Converge the player's provisioned profiles on the server's desired state.
   *
   * Idempotent and safe to call repeatedly: it installs a profile that is missing
   * or stale, and deletes every Tilecast-managed profile that no longer belongs.
   * A profile that is already current costs one status call and no credential
   * fetch, which is what keeps a later AirPlay session fast.
   */
  reconcile(): Promise<void> {
    return this.runExclusive(() => this.reconcileInternal());
  }

  private async reconcileInternal(): Promise<void> {
    await this.load();
    const capability = await this.helper.status();
    this.capability = capability;
    if (!capability.networkManagerAvailable) {
      // Nothing to reconcile and nothing to clean up: without NetworkManager
      // there are no Tilecast profiles on this box to begin with.
      this.setStatus({
        state: "unsupported",
        failureCode:
          capability.helperState === "missing"
            ? "helper_unavailable"
            : "network_manager_unavailable",
        failureMessage: capability.limitation,
      });
      return;
    }

    // Delete first. An assignment that moved from network A to network B should
    // not leave A's profile behind, and doing this before installing B means a
    // failure to install still leaves the player in a clean state.
    for (const networkId of obsoleteProfiles(
      this.assignment,
      capability.installedProfiles,
    )) {
      log.info("removing an obsolete Tilecast presentation network profile", {
        networkId,
      });
      await this.helper.delete(networkId);
      if (this.persisted.activeNetworkId === networkId) {
        await this.persist({ ...this.persisted, activeNetworkId: null });
      }
    }

    if (!this.assignment) {
      this.setStatus({ state: "unassigned" });
      return;
    }
    if (!capability.wifiAdapter) {
      this.setStatus({
        state: "failed",
        failureCode: "wifi_adapter_unavailable",
        failureMessage:
          "This player has no usable Wi-Fi adapter, so it cannot join a Presentation Network.",
      });
      return;
    }
    const fresh = await this.helper.status();
    this.capability = fresh;
    if (!profileNeedsProvisioning(this.assignment, fresh.installedProfiles)) {
      this.setStatus({ state: "provisioned" });
      return;
    }
    if (!this.assignment.credentialAvailable) {
      // The server has told us up front that it cannot produce the credential —
      // no sealing key, or a stored envelope that is empty. Reporting this now is
      // better than spending an AirPlay preparation window discovering it.
      this.setStatus({
        state: "failed",
        failureCode: "credential_unavailable",
        failureMessage:
          "The Presentation Network credential is unavailable on the Tilecast server.",
      });
      return;
    }
    this.setStatus({ state: "pending" });
    await this.provision();
  }

  /**
   * Fetch the credential and install the profile.
   *
   * This is the only place a credential exists in this process, and only for the
   * duration of the helper call. It is not returned, not stored, and not logged.
   */
  private async provision(): Promise<void> {
    const assignment = this.assignment;
    if (!assignment) return;
    let material: PresentationNetworkProvisioning;
    try {
      material = await this.fetchProvisioning();
    } catch (error) {
      this.setStatus({
        state: "failed",
        failureCode: "credential_unavailable",
        // The error from the server describes availability, never the credential.
        failureMessage: safeMessage(
          error,
          "The Presentation Network credential could not be retrieved.",
        ),
      });
      return;
    }
    if (material.presentationNetworkId !== assignment.presentationNetworkId) {
      // The assignment changed while the request was in flight. Drop this
      // material rather than installing a profile the server no longer wants.
      this.setStatus({ state: "pending" });
      return;
    }
    try {
      await this.helper.install(material);
    } catch (error) {
      this.setStatus({
        state: "failed",
        failureCode:
          error instanceof PresentationNetworkError
            ? error.code
            : "profile_install_failed",
        failureMessage: safeMessage(
          error,
          "The Presentation Network profile could not be installed.",
        ),
      });
      return;
    } finally {
      // Not a security control on its own — V8 owns the string — but it removes
      // the only long-lived reference this process holds.
      material.secret = "";
    }
    this.capability = await this.helper.status();
    log.info("installed a Tilecast presentation network profile", {
      networkId: assignment.presentationNetworkId,
      revision: assignment.configRevision,
    });
    this.setStatus({ state: "provisioned" });
  }

  /**
   * Join the assigned network for a session, and verify it is usable as a
   * sidecar before reporting success.
   *
   * The verification is the point. An activation that produced no address, or that
   * captured the default route, is a failure even though NetworkManager reported
   * the connection up: the first cannot carry AirPlay and the second would break
   * the player's own connection to Tilecast.
   */
  connect(reason: string): Promise<PresentationNetworkStatus> {
    return this.runExclusive(() => this.connectInternal(reason));
  }

  private async connectInternal(
    reason: string,
  ): Promise<PresentationNetworkStatus> {
    await this.load();
    const assignment = this.assignment;
    if (!assignment) {
      // Not an error. A screen with no assignment keeps the existing
      // Ethernet-only AirPlay behavior, and the caller proceeds.
      this.setStatus({ state: "unassigned" });
      return this.getStatus();
    }
    // Provision if needed, so a stale profile from a rotated credential is
    // replaced before the session rather than failing authentication during it.
    await this.reconcileInternal();
    if (this.status.state === "failed" || this.status.state === "unsupported") {
      throw new PresentationNetworkError(
        this.status.failureCode ?? "activation_failed",
        this.status.failureMessage ?? "The Presentation Network is not ready.",
      );
    }

    this.setStatus({ state: "joining" });
    log.info("joining the presentation network for a session", {
      networkId: assignment.presentationNetworkId,
      reason,
    });
    let activation;
    try {
      activation = await this.helper.activate(
        assignment.presentationNetworkId,
        ACTIVATION_TIMEOUT_MS,
      );
    } catch (error) {
      const code =
        error instanceof PresentationNetworkError
          ? error.code
          : "activation_failed";
      this.setStatus({
        state: "failed",
        failureCode: code,
        failureMessage: safeMessage(
          error,
          "The Presentation Network could not be joined.",
        ),
        lastFailureAt: new Date(this.now()).toISOString(),
      });
      throw error instanceof PresentationNetworkError
        ? error
        : new PresentationNetworkError(code, this.status.failureMessage!);
    }

    // Record the prior radio state before anything can fail, so teardown always
    // knows whether Tilecast may turn the radio back off.
    await this.persist({
      version: STATE_FORMAT,
      activeNetworkId: assignment.presentationNetworkId,
      radioWasEnabled: activation.radioWasEnabled,
    });

    if (!validIpv4(activation.ipv4)) {
      await this.disconnectInternal("no_address");
      this.setStatus({
        state: "failed",
        failureCode: "dhcp_timeout",
        failureMessage:
          "The Presentation Network did not provide a usable IPv4 address.",
        lastFailureAt: new Date(this.now()).toISOString(),
      });
      throw new PresentationNetworkError(
        "dhcp_timeout",
        this.status.failureMessage!,
      );
    }

    // Ethernet must still own the default route. A sidecar that captured it would
    // send this player's own Tilecast traffic — commands, heartbeats, downloads —
    // out over the presentation VLAN, which is exactly what this feature must not
    // do. Tearing the connection down is the correct response, not a warning.
    const capability = await this.helper.status();
    this.capability = capability;
    const routeInterface =
      activation.defaultRouteInterface || capability.defaultRouteInterface;
    if (
      !capability.wiredInterfaceAvailable ||
      !validIpv4(capability.wiredIpv4)
    ) {
      await this.disconnectInternal("ethernet_unavailable");
      this.setStatus({
        state: "failed",
        failureCode: "ethernet_default_route_lost",
        failureMessage:
          "Ethernet is no longer usable on this player, so Tilecast disconnected the temporary Wi-Fi connection.",
        lastFailureAt: new Date(this.now()).toISOString(),
      });
      throw new PresentationNetworkError(
        "ethernet_default_route_lost",
        this.status.failureMessage!,
      );
    }
    if (routeInterface && isWirelessInterfaceName(routeInterface)) {
      await this.disconnectInternal("default_route_captured");
      this.setStatus({
        state: "failed",
        failureCode: "ethernet_default_route_lost",
        failureMessage:
          "The temporary Wi-Fi connection became this player's default route, so Tilecast disconnected it.",
        lastFailureAt: new Date(this.now()).toISOString(),
      });
      throw new PresentationNetworkError(
        "ethernet_default_route_lost",
        this.status.failureMessage!,
      );
    }

    log.info("joined the presentation network", {
      networkId: assignment.presentationNetworkId,
      // The Wi-Fi address is deliberately absent: it is never an RTP destination
      // and putting it in a log invites someone to use it as one.
      defaultRouteInterface: routeInterface,
    });
    this.setStatus({
      state: "connected",
      lastConnectedAt: new Date(this.now()).toISOString(),
    });
    return this.getStatus();
  }

  /**
   * Leave the network cleanly.
   *
   * Idempotent, and safe to call when nothing is connected — which is the normal
   * case for a follower, for a screen with no assignment, and for the second of
   * two overlapping teardown paths. Only the Tilecast connection is brought down,
   * the saved profile is kept (with autoconnect off) so the next session is fast,
   * and the radio is turned off only if Tilecast turned it on.
   */
  disconnect(reason: string): Promise<void> {
    return this.runExclusive(() => this.disconnectInternal(reason));
  }

  private async disconnectInternal(reason: string): Promise<void> {
    await this.load();
    const active =
      this.persisted.activeNetworkId ??
      this.capability?.activeNetworkId ??
      null;
    if (!active) {
      this.setStatus({
        state: this.assignment ? "provisioned" : "unassigned",
        activeNetworkId: null,
      });
      return;
    }
    // Restore the radio only when Tilecast is the reason it is on. This is the
    // difference between leaving an operator's Wi-Fi as they had it and silently
    // disabling it.
    const restoreRadioDisabled = this.persisted.radioWasEnabled === false;
    log.info("leaving the presentation network", {
      networkId: active,
      reason,
      restoreRadioDisabled,
    });
    await this.helper.deactivate(active, restoreRadioDisabled);
    await this.persist({
      version: STATE_FORMAT,
      activeNetworkId: null,
      radioWasEnabled: true,
    });
    // Clear the cached capability's active connection as well. It is the fallback
    // source when the persisted file does not know about a connection — which is
    // what makes crash recovery work — and leaving a stale value here would make a
    // second disconnect try to bring the same connection down again.
    if (this.capability) {
      this.capability = { ...this.capability, activeNetworkId: "" };
    }
    this.setStatus({
      state: this.assignment ? "provisioned" : "unassigned",
      activeNetworkId: null,
    });
  }

  /**
   * Clean up a connection a crash left behind.
   *
   * Called at startup when there is no valid AirPlay session. A Tilecast-managed
   * connection that is up with nothing presenting is leftover state, and leaving
   * it would hold the radio on and keep the player on a VLAN it has no reason to
   * be on. Unrelated Wi-Fi profiles are never touched, because the helper can only
   * name connections in Tilecast's own namespace.
   */
  cleanupOrphaned(): Promise<void> {
    return this.runExclusive(async () => {
      await this.load();
      const capability = await this.helper.status();
      this.capability = capability;
      if (!capability.networkManagerAvailable) return;
      const active =
        capability.activeNetworkId || this.persisted.activeNetworkId;
      if (!active) {
        if (this.persisted.activeNetworkId) {
          await this.persist({
            version: STATE_FORMAT,
            activeNetworkId: null,
            radioWasEnabled: true,
          });
        }
        return;
      }
      log.warn(
        "cleaning up a presentation network connection left by a crash",
        {
          networkId: active,
        },
      );
      await this.helper.deactivate(
        active,
        this.persisted.radioWasEnabled === false,
      );
      await this.persist({
        version: STATE_FORMAT,
        activeNetworkId: null,
        radioWasEnabled: true,
      });
      this.capability = { ...capability, activeNetworkId: "" };
      this.setStatus({
        state: this.assignment ? "provisioned" : "unassigned",
        activeNetworkId: null,
      });
    });
  }

  /** Whether a Tilecast connection is currently up, for restart recovery. */
  async hasActiveConnection(): Promise<boolean> {
    await this.load();
    const capability = await this.helper.status();
    this.capability = capability;
    return Boolean(
      capability.activeNetworkId || this.persisted.activeNetworkId,
    );
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const raw = await this.store
      .readJson<Partial<PersistedPresentationNetworkState>>(STATE_FILE)
      .catch(() => null);
    if (!raw || raw.version !== STATE_FORMAT) {
      // An unrecognized file is discarded rather than guessed at. The
      // conservative default is "the radio was already on", which means Tilecast
      // will not turn it off — leaving a radio enabled is recoverable, silently
      // disabling an operator's Wi-Fi is not.
      return;
    }
    this.persisted = {
      version: STATE_FORMAT,
      activeNetworkId:
        typeof raw.activeNetworkId === "string" ? raw.activeNetworkId : null,
      radioWasEnabled: raw.radioWasEnabled !== false,
    };
  }

  private async persist(
    state: PersistedPresentationNetworkState,
  ): Promise<void> {
    this.persisted = state;
    // No credential field exists in this shape, by construction.
    await this.store.writeJson(STATE_FILE, state).catch((error) => {
      log.warn("failed to persist presentation network state", {
        error: String(error),
      });
    });
  }

  private setStatus(update: Partial<PresentationNetworkStatus>): void {
    const assignment = this.assignment;
    const installed = assignment
      ? this.capability?.installedProfiles.find(
          (item) => item.networkId === assignment.presentationNetworkId,
        )
      : undefined;
    const next: PresentationNetworkStatus = {
      state: update.state ?? this.status.state,
      networkName: assignment?.name ?? "",
      networkId: assignment?.presentationNetworkId ?? null,
      activeNetworkId:
        update.activeNetworkId !== undefined
          ? update.activeNetworkId
          : (this.persisted.activeNetworkId ??
            this.capability?.activeNetworkId ??
            null),
      installedNetworkId: installed ? installed.networkId : null,
      installedRevision: installed ? installed.revision : null,
      ...(update.failureCode ? { failureCode: update.failureCode } : {}),
      ...(update.failureMessage
        ? { failureMessage: update.failureMessage.slice(0, 240) }
        : {}),
      ...((update.lastConnectedAt ?? this.status.lastConnectedAt)
        ? {
            lastConnectedAt:
              update.lastConnectedAt ?? this.status.lastConnectedAt,
          }
        : {}),
      ...((update.lastFailureAt ?? this.status.lastFailureAt)
        ? { lastFailureAt: update.lastFailureAt ?? this.status.lastFailureAt }
        : {}),
    };
    this.status = next;
    this.publish();
  }

  private publish(): void {
    this.onStatus?.({ ...this.status });
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation, operation);
    this.operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/**
 * Whether an interface name is a wireless one, used only to detect a sidecar that
 * captured the default route. Predictable names put wireless interfaces under
 * `wl*`, and the classic names are `wlan*`/`ath*`/`ra*`.
 */
export function isWirelessInterfaceName(name: string): boolean {
  return /^(wl|wlan|wlp|ath|ra)[0-9a-z]*/i.test(name);
}

/**
 * A message that is safe to report. Bounded, and drawn from errors that describe
 * availability and rules rather than values — nothing upstream of here puts a
 * credential in an error.
 */
function safeMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : "";
  return (text.trim() ? text : fallback).slice(0, 240);
}

export function unsupportedPresentationNetwork(): PresentationNetworkCapability {
  return unsupportedPresentationNetworkCapability(
    "unsupported",
    "Presentation Networks are supported on Linux players with NetworkManager.",
  );
}
