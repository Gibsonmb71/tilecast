import { randomBytes } from "crypto";

/** Fixed ports are part of the AirPlay firewall contract. */
export const AIRPLAY_PORTS = {
  uxplayBase: 37_000,
  uxplay: [37_000, 37_001, 37_002] as const,
  videoRtp: 42_000,
  audioRtp: 42_002,
  mdns: 5_353,
} as const;

export type AirplayTransport = "unicast" | "multicast";
export type AirplayVideoProfile = "1080p30" | "720p30";
export type ExternalPresentationRole = "single" | "gateway" | "receiver";

export interface AirplayCapabilities {
  airplaySupported: boolean;
  uxplayInstalled: boolean;
  uxplayVersion: string | null;
  gstreamerInstalled: boolean;
  h264DecoderAvailable: boolean;
  hardwareH264Decode: boolean;
  decoder: "vah264dec" | "vaapih264dec" | "avdec_h264" | null;
  maxProfile: AirplayVideoProfile | "unsupported";
  groupAirplaySupported: boolean;
  audioAvailable: boolean;
  receiverVideoSink: "vaapisink" | "autovideosink";
  avahiAvailable: boolean;
  mdnsAdvertisementAvailable: boolean;
  multicastSupported: boolean | null;
  multicastTestStatus: "not_tested" | "passed" | "failed" | "unsupported";
  limitation?: string;
}

export interface AirplayDestination {
  screenId: string;
  host: string;
  port: number;
}

export interface ExternalPresentationConfig {
  provider: "airplay";
  sessionId: string;
  receiverName: string;
  pin: string;
  deviceId: string;
  expiresAt: string;
  role: ExternalPresentationRole;
  targetType: "screen" | "group";
  targetId: string;
  gatewayScreenId: string;
  audioScreenId: string;
  transport: AirplayTransport;
  videoPort: number;
  destinations: AirplayDestination[];
  multicastAddress?: string;
  profile: AirplayVideoProfile;
  audioMode: "gateway_only" | "none" | "all";
}

function stringField(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.trim() === "") {
    throw new Error(`AirPlay payload field ${key} is invalid`);
  }
  return result.trim();
}

/** Strictly decode a server command; no arbitrary values reach a process. */
export function parseExternalPresentationConfig(
  value: unknown,
): ExternalPresentationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AirPlay payload must be an object");
  }
  const raw = value as Record<string, unknown>;
  const provider = stringField(raw, "provider");
  const role = stringField(raw, "role");
  const targetType = stringField(raw, "targetType");
  const transport = stringField(raw, "transport");
  const audioMode = stringField(raw, "audioMode");
  const destinations = raw["destinations"];
  if (!Array.isArray(destinations))
    throw new Error("AirPlay destinations are required");
  const parsedDestinations = destinations.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("AirPlay destination is invalid");
    }
    const destination = item as Record<string, unknown>;
    const port = destination["port"];
    if (typeof port !== "number" || !Number.isInteger(port)) {
      throw new Error("AirPlay destination port is invalid");
    }
    return {
      screenId: stringField(destination, "screenId"),
      host: stringField(destination, "host"),
      port,
    };
  });
  const videoPort = raw["videoPort"];
  if (typeof videoPort !== "number" || !Number.isInteger(videoPort)) {
    throw new Error("AirPlay video port is invalid");
  }
  if (
    !["single", "gateway", "receiver"].includes(role) ||
    !["screen", "group"].includes(targetType) ||
    !["unicast", "multicast"].includes(transport) ||
    !["gateway_only", "none", "all"].includes(audioMode)
  ) {
    throw new Error("AirPlay payload role or transport is invalid");
  }
  const config: ExternalPresentationConfig = {
    provider: provider as "airplay",
    sessionId: stringField(raw, "sessionId"),
    receiverName: stringField(raw, "receiverName"),
    pin: stringField(raw, "pin"),
    deviceId: stringField(raw, "deviceId"),
    expiresAt: stringField(raw, "expiresAt"),
    role: role as ExternalPresentationRole,
    targetType: targetType as "screen" | "group",
    targetId: stringField(raw, "targetId"),
    gatewayScreenId: stringField(raw, "gatewayScreenId"),
    audioScreenId: stringField(raw, "audioScreenId"),
    transport: transport as AirplayTransport,
    videoPort,
    destinations: parsedDestinations,
    multicastAddress:
      typeof raw["multicastAddress"] === "string"
        ? raw["multicastAddress"]
        : undefined,
    profile: raw["profile"] as AirplayVideoProfile,
    audioMode: audioMode as "gateway_only" | "none" | "all",
  };
  if (config.provider !== "airplay")
    throw new Error("AirPlay provider is invalid");
  if (!isAirplayProfile(config.profile))
    throw new Error("AirPlay profile is invalid");
  return config;
}

export type ExternalPresentationProcessState =
  "preparing" | "waiting" | "connected" | "degraded" | "stopped";

export interface ExternalPresentationStatus {
  provider: "airplay";
  sessionId: string;
  role: ExternalPresentationRole;
  state: ExternalPresentationProcessState;
  connected: boolean;
  receiverAlive: boolean;
  gatewayAlive: boolean;
  lastRtpAt?: string;
  failureCode?: string;
  failureMessage?: string;
}

export function profileDimensions(profile: AirplayVideoProfile): {
  width: number;
  height: number;
  fps: 30;
} {
  return profile === "1080p30"
    ? { width: 1920, height: 1080, fps: 30 }
    : { width: 1280, height: 720, fps: 30 };
}

/**
 * AirPlay sessions deliberately use a short-lived virtual identity. The
 * locally-administered bit is set and the multicast bit is clear.
 */
export function randomAirplayDeviceId(random = randomBytes(6)): string {
  const bytes = Buffer.from(random.subarray(0, 6));
  bytes[0] = (bytes[0]! | 0x02) & 0xfe;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(":");
}

export function randomAirplayPin(random = randomBytes(4)): string {
  const value = random.readUInt32BE(0) % 10_000;
  return value.toString().padStart(4, "0");
}

export function isAirplayPin(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{4}$/.test(value);
}

export function isAirplayDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value) &&
    (parseInt(value.slice(0, 2), 16) & 0x02) !== 0 &&
    (parseInt(value.slice(0, 2), 16) & 0x01) === 0
  );
}

export function isAirplayProfile(value: unknown): value is AirplayVideoProfile {
  return value === "1080p30" || value === "720p30";
}

export function commonAirplayProfile(
  capabilities: readonly Pick<
    AirplayCapabilities,
    "hardwareH264Decode" | "maxProfile"
  >[],
): AirplayVideoProfile | null {
  if (capabilities.length === 0) return null;
  if (
    capabilities.every(
      (item) => item.hardwareH264Decode && item.maxProfile === "1080p30",
    )
  ) {
    return "1080p30";
  }
  if (
    capabilities.every(
      (item) => item.maxProfile === "1080p30" || item.maxProfile === "720p30",
    )
  ) {
    return "720p30";
  }
  return null;
}

export interface GatewayCandidate {
  id: string;
  name: string;
  online: boolean;
  platform: string;
  airplaySupported: boolean;
  hardwareH264Decode: boolean;
  wired: boolean;
}

/** Stable gateway selection: capability order first, screen identity last. */
export function chooseAirplayGateway(
  candidates: readonly GatewayCandidate[],
  preferredId?: string | null,
): GatewayCandidate | null {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.online &&
      candidate.platform === "linux" &&
      candidate.airplaySupported,
  );
  const preferred = eligible.find((candidate) => candidate.id === preferredId);
  if (preferred) return preferred;
  return (
    [...eligible].sort((left, right) => {
      const score = (candidate: GatewayCandidate) =>
        (candidate.hardwareH264Decode ? 8 : 0) +
        (candidate.wired ? 4 : 0) +
        (candidate.platform === "linux" ? 2 : 0) +
        (candidate.airplaySupported ? 1 : 0);
      const difference = score(right) - score(left);
      if (difference !== 0) return difference;
      return `${left.name}\u0000${left.id}`.localeCompare(
        `${right.name}\u0000${right.id}`,
      );
    })[0] ?? null
  );
}

export function isExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return !Number.isFinite(expires) || expires <= nowMs;
}
