/**
 * Presentation Network types, parsing, and the helper protocol.
 *
 * A Presentation Network is a reusable organization Wi-Fi definition that this
 * player joins *temporarily* on its Wi-Fi adapter while AirPlay Present runs, so
 * senders on a Wi-Fi VLAN can discover and reach UxPlay. Ethernet keeps the
 * default route and keeps carrying everything Tilecast needs: the server
 * connection, commands, the WebSocket, heartbeats, downloads, and group AirPlay
 * RTP fan-out. Tilecast does not route or bridge the two networks.
 *
 * The privilege boundary is the reason this module is thin. The Electron player
 * runs as the unprivileged kiosk account and cannot manage NetworkManager. It
 * asks a root-owned local helper (`tilecast-networkd`) over a unix socket for one
 * of five explicit operations, and the helper validates every field again before
 * it touches anything.
 *
 * Credential handling, in one place:
 *  - The Wi-Fi credential never appears in a durable player command payload, in
 *    `player-config.json`, in `airplay-session.json`, in
 *    `presentation-network.json`, or in any log line.
 *  - It is fetched from the server over the authenticated player channel only
 *    when a profile actually has to be installed, held in memory for the length
 *    of that one install call, and handed to the helper over the socket — never
 *    in a process argument, where `ps` would show it.
 */

import { createConnection, type Socket } from "net";

/** Only the authentication types Tilecast has actually validated. */
export type PresentationNetworkSecurity = "wpa_psk" | "wpa_eap_peap_mschapv2";

export function isPresentationNetworkSecurity(
  value: unknown,
): value is PresentationNetworkSecurity {
  return value === "wpa_psk" || value === "wpa_eap_peap_mschapv2";
}

/**
 * The non-secret assignment, delivered through ordinary configuration sync.
 *
 * `assigned: false` is a real instruction, not an absence: it tells the player to
 * remove any Tilecast-managed Wi-Fi profile it still holds. That is how an
 * assignment removal reaches a player that was offline when it happened, without
 * a command that could expire first.
 */
export interface PresentationNetworkAssignment {
  presentationNetworkId: string;
  name: string;
  ssid: string;
  hidden: boolean;
  security: PresentationNetworkSecurity;
  configRevision: number;
  profileName: string;
  /** False when the server has no sealing key or no stored credential. */
  credentialAvailable: boolean;
  identity: string;
  anonymousIdentity: string;
  domainSuffixMatch: string;
  caCertificateSet: boolean;
}

/**
 * The credential plus everything needed to build a profile, fetched over the
 * authenticated player channel.
 *
 * Deliberately not persisted anywhere. It exists between the fetch and the
 * helper's install call and is then dropped.
 */
export interface PresentationNetworkProvisioning extends Omit<
  PresentationNetworkAssignment,
  "credentialAvailable" | "caCertificateSet"
> {
  secret: string;
  caCertificatePem: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  limit: number,
): string {
  const value = raw[key];
  if (typeof value !== "string") return "";
  if (value.length > limit) {
    throw new Error(`Presentation Network field ${key} is too long`);
  }
  return value;
}

/**
 * Strictly decode the configuration section. Anything unexpected throws rather
 * than being coerced: a half-understood assignment would provision a profile that
 * does not match what Studio shows.
 */
export function parsePresentationNetworkAssignment(
  value: unknown,
): PresentationNetworkAssignment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw["assigned"] !== true) return null;
  const id = raw["presentationNetworkId"];
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
    throw new Error("Presentation Network ID is invalid");
  }
  const ssid = raw["ssid"];
  if (typeof ssid !== "string" || ssid.length === 0 || ssid.length > 32) {
    throw new Error("Presentation Network SSID is invalid");
  }
  const security = raw["security"];
  if (!isPresentationNetworkSecurity(security)) {
    throw new Error("Presentation Network authentication type is unsupported");
  }
  const revision = raw["configRevision"];
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    throw new Error("Presentation Network configuration revision is invalid");
  }
  return {
    presentationNetworkId: id.toLowerCase(),
    name: optionalString(raw, "name", 120),
    ssid,
    hidden: raw["hidden"] === true,
    security,
    configRevision: revision,
    profileName: presentationNetworkProfileName(id.toLowerCase()),
    credentialAvailable: raw["credentialAvailable"] === true,
    identity: optionalString(raw, "identity", 253),
    anonymousIdentity: optionalString(raw, "anonymousIdentity", 253),
    domainSuffixMatch: optionalString(raw, "domainSuffixMatch", 253),
    caCertificateSet: raw["caCertificateSet"] === true,
  };
}

/** Strictly decode the provisioning response, credential included. */
export function parsePresentationNetworkProvisioning(
  value: unknown,
): PresentationNetworkProvisioning {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Presentation Network provisioning response is invalid");
  }
  const raw = value as Record<string, unknown>;
  const assignment = parsePresentationNetworkAssignment({
    ...raw,
    assigned: true,
    credentialAvailable: true,
    // The provisioning response nests its non-secret 802.1X metadata, unlike the
    // flat configuration section.
    ...flattenAuth(raw["auth"]),
  });
  if (!assignment) {
    throw new Error("Presentation Network provisioning response is invalid");
  }
  const secret = raw["secret"];
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    secret.length > 128
  ) {
    // The message names the rule, never the value.
    throw new Error("Presentation Network credential is invalid");
  }
  const auth = (raw["auth"] ?? {}) as Record<string, unknown>;
  const certificate = auth["caCertificatePem"];
  return {
    ...assignment,
    secret,
    caCertificatePem: typeof certificate === "string" ? certificate : "",
  };
}

function flattenAuth(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const auth = value as Record<string, unknown>;
  return {
    identity: auth["identity"],
    anonymousIdentity: auth["anonymousIdentity"],
    domainSuffixMatch: auth["domainSuffixMatch"],
    caCertificateSet:
      typeof auth["caCertificatePem"] === "string" &&
      (auth["caCertificatePem"] as string).length > 0,
  };
}

/**
 * The NetworkManager connection name Tilecast owns. The namespace is the safety
 * property: the helper only ever acts on a connection with this shape, so an
 * operator's own Wi-Fi profile and the machine's Ethernet connection are outside
 * its reach.
 */
export function presentationNetworkProfileName(networkId: string): string {
  return `tilecast-presentation-${networkId}`;
}

/** What the player reports to the server, and what Studio turns into a status. */
export type PresentationNetworkState =
  | "unsupported"
  | "unassigned"
  | "pending"
  | "provisioned"
  | "joining"
  | "connected"
  | "failed";

/** Stable failure codes. Studio maps these to operator sentences. */
export type PresentationNetworkFailureCode =
  | "helper_unavailable"
  | "network_manager_unavailable"
  | "wifi_adapter_unavailable"
  | "credential_unavailable"
  | "profile_install_failed"
  | "authentication_failed"
  | "ssid_not_found"
  | "association_timeout"
  | "dhcp_timeout"
  | "radio_unavailable"
  | "ethernet_default_route_lost"
  | "activation_failed";

export interface PresentationNetworkCapability {
  /** NetworkManager is reachable AND the root helper is healthy. */
  supported: boolean;
  helperState: "ok" | "missing" | "unhealthy" | "unsupported";
  networkManagerAvailable: boolean;
  wifiAdapter: boolean;
  radioEnabled: boolean;
  wiredInterfaceAvailable: boolean;
  /** The explicit Ethernet IPv4 address group AirPlay RTP is fanned out to. */
  wiredIpv4: string;
  /** The interface carrying the default route. Local diagnostics only. */
  defaultRouteInterface: string;
  activeNetworkId: string;
  installedProfiles: { networkId: string; revision: number }[];
  limitation?: string;
}

export function unsupportedPresentationNetworkCapability(
  helperState: PresentationNetworkCapability["helperState"],
  limitation: string,
): PresentationNetworkCapability {
  return {
    supported: false,
    helperState,
    networkManagerAvailable: false,
    wifiAdapter: false,
    radioEnabled: false,
    wiredInterfaceAvailable: false,
    wiredIpv4: "",
    defaultRouteInterface: "",
    activeNetworkId: "",
    installedProfiles: [],
    limitation,
  };
}

export interface PresentationNetworkActivation {
  ipv4: string;
  /**
   * Whether the Wi-Fi radio was already enabled before Tilecast activated the
   * connection. It decides whether Tilecast may turn the radio off afterwards: a
   * machine whose Wi-Fi was already on keeps it on.
   */
  radioWasEnabled: boolean;
  defaultRouteInterface: string;
  wiredIpv4: string;
}

export class PresentationNetworkError extends Error {
  constructor(
    readonly code: PresentationNetworkFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "PresentationNetworkError";
  }
}

export const DEFAULT_HELPER_SOCKET = "/run/tilecast/networkd.sock";

/**
 * The bound on one activation. This is a local operation timeout on a single
 * helper call, not a session lifecycle timer: the AirPlay preparation deadline
 * itself remains durable server state. Enterprise authentication plus DHCP
 * routinely takes tens of seconds, so the budget reflects that rather than a
 * process start.
 */
export const ACTIVATION_TIMEOUT_MS = 75_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 256 * 1024;

type SocketFactory = (path: string) => Socket;

export interface HelperClientOptions {
  socketPath?: string;
  connect?: SocketFactory;
}

/**
 * Typed client for the root-owned helper.
 *
 * Every request is a single JSON object with an explicit `op`. There is no
 * generic command, no shell, and no path the caller can influence — the helper
 * would reject one anyway, but the client does not offer one either.
 */
export class PresentationNetworkHelperClient {
  private readonly socketPath: string;
  private readonly connect: SocketFactory;

  constructor(options: HelperClientOptions = {}) {
    this.socketPath =
      options.socketPath ??
      process.env["TILECAST_NETWORKD_SOCKET"] ??
      DEFAULT_HELPER_SOCKET;
    this.connect =
      options.connect ?? ((path: string) => createConnection({ path }));
  }

  /**
   * Ask the helper for capability and current state.
   *
   * A helper that is not installed or not running is reported as such rather
   * than guessed at, because "no helper" and "no Wi-Fi adapter" send an operator
   * to two entirely different fixes.
   */
  async status(): Promise<PresentationNetworkCapability> {
    let response: Record<string, unknown>;
    try {
      response = await this.request({ op: "status" }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "ECONNREFUSED") {
        return unsupportedPresentationNetworkCapability(
          "missing",
          "The Tilecast presentation-network helper is not installed or not running. Re-run the player installer to add it.",
        );
      }
      return unsupportedPresentationNetworkCapability(
        "unhealthy",
        "The Tilecast presentation-network helper is installed but did not respond.",
      );
    }
    if (response["ok"] !== true) {
      return unsupportedPresentationNetworkCapability(
        "unhealthy",
        "The Tilecast presentation-network helper reported a failure.",
      );
    }
    const managerAvailable = response["networkManagerAvailable"] === true;
    const wifiAdapter = response["wifiAdapter"] === true;
    const profiles: { networkId: string; revision: number }[] = [];
    if (Array.isArray(response["profiles"])) {
      for (const item of response["profiles"] as unknown[]) {
        if (!item || typeof item !== "object") continue;
        const entry = item as Record<string, unknown>;
        const id = entry["networkId"];
        const revision = entry["revision"];
        if (typeof id === "string" && UUID_PATTERN.test(id)) {
          profiles.push({
            networkId: id.toLowerCase(),
            revision:
              typeof revision === "number" && Number.isInteger(revision)
                ? revision
                : 0,
          });
        }
      }
    }
    const limitation = response["limitation"];
    return {
      // "Supported" is NetworkManager plus a healthy helper. The Wi-Fi adapter is
      // reported separately because a box that could manage a connection but has
      // no radio is a different, cheaper problem to fix.
      supported: managerAvailable,
      helperState: managerAvailable ? "ok" : "unsupported",
      networkManagerAvailable: managerAvailable,
      wifiAdapter,
      radioEnabled: response["radioEnabled"] === true,
      wiredInterfaceAvailable: response["wiredInterfaceAvailable"] === true,
      wiredIpv4: validIpv4(response["wiredIpv4"])
        ? String(response["wiredIpv4"])
        : "",
      defaultRouteInterface:
        typeof response["defaultRouteInterface"] === "string"
          ? response["defaultRouteInterface"]
          : "",
      activeNetworkId:
        typeof response["activeNetworkId"] === "string" &&
        UUID_PATTERN.test(response["activeNetworkId"])
          ? response["activeNetworkId"].toLowerCase()
          : "",
      installedProfiles: profiles,
      ...(typeof limitation === "string" && limitation ? { limitation } : {}),
    };
  }

  /**
   * Install or replace one validated profile.
   *
   * The credential travels over the unix socket — kernel memory — so it never
   * appears in a process argument list. The helper writes it into
   * NetworkManager's protected system connection store at mode 0600.
   */
  async install(material: PresentationNetworkProvisioning): Promise<void> {
    const response = await this.request(
      {
        op: "install",
        networkId: material.presentationNetworkId,
        revision: material.configRevision,
        ssid: material.ssid,
        hidden: material.hidden,
        security: material.security,
        secret: material.secret,
        identity: material.identity,
        anonymousIdentity: material.anonymousIdentity,
        domainSuffixMatch: material.domainSuffixMatch,
        caCertificatePem: material.caCertificatePem,
      },
      REQUEST_TIMEOUT_MS,
    );
    if (response["ok"] !== true) {
      throw new PresentationNetworkError(
        "profile_install_failed",
        // The helper's message describes the rule that failed, never a value.
        helperMessage(
          response,
          "The Presentation Network profile could not be installed.",
        ),
      );
    }
  }

  async activate(
    networkId: string,
    timeoutMs = ACTIVATION_TIMEOUT_MS,
  ): Promise<PresentationNetworkActivation> {
    const seconds = Math.max(15, Math.min(180, Math.round(timeoutMs / 1_000)));
    const response = await this.request(
      { op: "activate", networkId, timeoutSeconds: seconds },
      // Allow the helper's own budget plus slack before giving up on the socket.
      seconds * 1_000 + 10_000,
    );
    if (response["ok"] !== true) {
      throw new PresentationNetworkError(
        activationFailureCode(response["code"]),
        helperMessage(
          response,
          "The Presentation Network could not be activated.",
        ),
      );
    }
    return {
      ipv4: validIpv4(response["ipv4"]) ? String(response["ipv4"]) : "",
      radioWasEnabled: response["radioWasEnabled"] === true,
      defaultRouteInterface:
        typeof response["defaultRouteInterface"] === "string"
          ? response["defaultRouteInterface"]
          : "",
      wiredIpv4: validIpv4(response["wiredIpv4"])
        ? String(response["wiredIpv4"])
        : "",
    };
  }

  /**
   * Bring the Tilecast connection down.
   *
   * `restoreRadioDisabled` is only true when Tilecast is the reason the radio
   * came on. The saved profile itself is deliberately kept, with autoconnect off,
   * so a later session is fast. Never fails loudly: cleanup has to be idempotent.
   */
  async deactivate(
    networkId: string,
    restoreRadioDisabled: boolean,
  ): Promise<void> {
    await this.request(
      { op: "deactivate", networkId, restoreRadioDisabled },
      REQUEST_TIMEOUT_MS,
    ).catch(() => ({}));
  }

  /** Remove a Tilecast-managed profile. Idempotent. */
  async delete(networkId: string): Promise<void> {
    await this.request({ op: "delete", networkId }, REQUEST_TIMEOUT_MS).catch(
      () => ({}),
    );
  }

  private request(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let socket: Socket;
      try {
        socket = this.connect(this.socketPath);
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      let buffered = "";
      const finish = (error: Error | null, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(value ?? {});
      };
      const timer = setTimeout(() => {
        finish(
          new PresentationNetworkError(
            "helper_unavailable",
            "The Tilecast presentation-network helper did not respond in time.",
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      socket.setEncoding("utf8");
      socket.on("connect", () => {
        socket.write(`${JSON.stringify(payload)}\n`);
      });
      socket.on("data", (chunk: string) => {
        buffered += chunk;
        if (buffered.length > MAX_RESPONSE_BYTES) {
          finish(
            new PresentationNetworkError(
              "helper_unavailable",
              "The Tilecast presentation-network helper returned an oversized response.",
            ),
          );
          return;
        }
        const newline = buffered.indexOf("\n");
        if (newline < 0) return;
        try {
          const parsed = JSON.parse(buffered.slice(0, newline)) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object");
          }
          finish(null, parsed as Record<string, unknown>);
        } catch {
          finish(
            new PresentationNetworkError(
              "helper_unavailable",
              "The Tilecast presentation-network helper returned an unreadable response.",
            ),
          );
        }
      });
      socket.on("error", (error) => finish(error));
      socket.on("close", () => {
        finish(
          new PresentationNetworkError(
            "helper_unavailable",
            "The Tilecast presentation-network helper closed the connection.",
          ),
        );
      });
    });
  }
}

function helperMessage(
  response: Record<string, unknown>,
  fallback: string,
): string {
  const message = response["message"];
  return typeof message === "string" && message.trim()
    ? message.slice(0, 200)
    : fallback;
}

/**
 * Map the helper's stable code onto the player's. Anything unrecognized becomes
 * the generic activation failure rather than being passed through, so a future
 * helper cannot introduce a code Studio has no sentence for.
 */
export function activationFailureCode(
  value: unknown,
): PresentationNetworkFailureCode {
  const known: PresentationNetworkFailureCode[] = [
    "authentication_failed",
    "ssid_not_found",
    "association_timeout",
    "dhcp_timeout",
    "radio_unavailable",
    "wifi_adapter_unavailable",
    "network_manager_unavailable",
    "activation_failed",
  ];
  if (typeof value === "string") {
    const match = known.find((candidate) => candidate === value);
    if (match) return match;
    if (value === "profile_missing") return "profile_install_failed";
  }
  return "activation_failed";
}

/**
 * A usable group-RTP destination, applied identically here and on the server.
 *
 * Unspecified, loopback, multicast, and link-local addresses are all things a
 * dual-homed box can plausibly hold and none of them is somewhere another display
 * can be reached. Rejecting them turns a silently black room into a precise
 * readiness error.
 */
export function validIpv4(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.trim().split(".");
  if (parts.length !== 4) return false;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return false;
    const octet = Number(part);
    if (octet > 255) return false;
    octets.push(octet);
  }
  const [first, second] = octets as [number, number, number, number];
  if (first === 0) return false;
  if (first === 127) return false;
  if (first >= 224) return false;
  if (first === 169 && second === 254) return false;
  return true;
}

/**
 * Whether a provisioned profile matches what the server currently says.
 *
 * A revision mismatch means the credential rotated or the SSID/security changed,
 * and the stale profile has to be replaced rather than reused — that is what
 * turns a rotated password into a working session instead of an authentication
 * failure the next time the room presents.
 */
export function profileNeedsProvisioning(
  assignment: PresentationNetworkAssignment,
  installed: readonly { networkId: string; revision: number }[],
): boolean {
  const current = installed.find(
    (item) => item.networkId === assignment.presentationNetworkId,
  );
  return !current || current.revision !== assignment.configRevision;
}

/**
 * Tilecast-managed profiles that should no longer exist on this player.
 *
 * Reconciling against the desired state rather than acting on a removal event is
 * what makes cleanup work for a player that was offline when the assignment
 * changed, and what makes it idempotent.
 */
export function obsoleteProfiles(
  assignment: PresentationNetworkAssignment | null,
  installed: readonly { networkId: string; revision: number }[],
): string[] {
  return installed
    .map((item) => item.networkId)
    .filter((id) => id !== assignment?.presentationNetworkId);
}
