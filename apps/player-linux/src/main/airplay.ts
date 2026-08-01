/**
 * Linux AirPlay process manager.
 *
 * UxPlay and the group GStreamer receiver are external processes on purpose.
 * The player runtime decides when an external presentation owns the screen;
 * this module owns the Linux process lifecycle, fixed ports, decoder choice,
 * and local expiry. No shell is involved: every executable is started with
 * spawn(binary, args), and all values that came from the server are validated
 * before they are placed in a process argument.
 */

import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import { logger } from "../core/log";
import {
  AIRPLAY_PORTS,
  isAirplayDeviceId,
  isAirplayPin,
  isAirplayProfile,
  isExpired,
  profileDimensions,
  type AirplayCapabilities,
  type AirplayDestination,
  type AirplayTransport,
  type ExternalPresentationConfig,
  type ExternalPresentationProcessState,
  type ExternalPresentationRole,
  type ExternalPresentationStatus,
} from "../core/external-presentation";
import type { StateStore } from "../core/storage";

const log = logger("airplay");
const SESSION_FILE = "airplay-session.json";
const UXPLAY_BASELINE = "1.73.6";
const HEALTH_INTERVAL_MS = 2_000;
const RECEIVER_LATENCY_MS = 80;
const MAX_PROCESS_RESTARTS = 2;

type SpawnedProcess = ChildProcess;
type SpawnFunction = typeof nodeSpawn;

interface ManagedProcess {
  child: SpawnedProcess;
  kind: "uxplay" | "receiver";
  stopping: boolean;
}

export interface AirplayManagerOptions {
  store: StateStore;
  spawn?: SpawnFunction;
  now?: () => number;
  onStatus?: (status: ExternalPresentationStatus | null) => void;
}

const SUPPORTED_DECODERS = ["vah264dec", "vaapih264dec", "avdec_h264"] as const;
type SupportedDecoder = (typeof SUPPORTED_DECODERS)[number];

function commandOutput(child: SpawnedProcess): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.once("error", () => resolve({ code: null, stdout, stderr }));
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function probeCommand(
  spawn: SpawnFunction,
  binary: string,
  args: string[],
  timeoutMs = 5_000,
): Promise<{ ok: boolean; output: string }> {
  let child: SpawnedProcess;
  try {
    child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    return { ok: false, output: "" };
  }
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const result = await commandOutput(child);
    return {
      ok: result.code === 0,
      output: `${result.stdout}\n${result.stderr}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseUxplayVersion(output: string): string | null {
  const match = output.match(
    /(?:UxPlay|uxplay)[^0-9]*([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i,
  );
  return match?.[1] ?? null;
}

export function versionAtLeast(
  version: string | null,
  baseline: string,
): boolean {
  if (!version) return false;
  const parse = (value: string) => value.split(".").map((part) => Number(part));
  const actual = parse(version);
  const expected = parse(baseline);
  for (
    let index = 0;
    index < Math.max(actual.length, expected.length);
    index += 1
  ) {
    const left = actual[index] ?? 0;
    const right = expected[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export function selectDecoder(pluginOutput: {
  vah264dec: boolean;
  vaapih264dec: boolean;
  avdec_h264: boolean;
}): SupportedDecoder | null {
  return SUPPORTED_DECODERS.find((decoder) => pluginOutput[decoder]) ?? null;
}

export function buildReceiverArgs(
  config: Pick<ExternalPresentationConfig, "videoPort" | "profile"> & {
    decoder: SupportedDecoder;
    transport?: AirplayTransport;
    multicastAddress?: string;
    videoSink?: "vaapisink" | "autovideosink";
  },
): string[] {
  const { width, height } = profileDimensions(config.profile);
  const source = ["udpsrc", `port=${config.videoPort}`];
  if (config.transport === "multicast" && config.multicastAddress) {
    source.push(
      `multicast-group=${config.multicastAddress}`,
      "auto-multicast=true",
    );
  }
  return [
    "-e",
    ...source,
    "caps=application/x-rtp,media=video,clock-rate=90000,encoding-name=H264,payload=96",
    "!",
    "rtpjitterbuffer",
    `latency=${RECEIVER_LATENCY_MS}`,
    "drop-on-latency=true",
    "!",
    "rtph264depay",
    "!",
    "h264parse",
    "config-interval=-1",
    "!",
    config.decoder,
    "!",
    "videoconvert",
    "!",
    "videoscale",
    "!",
    `video/x-raw,width=${width},height=${height}`,
    "!",
    // fpsdisplaysink gives the manager a low-rate, packet-derived health
    // signal. It also makes the incoming FPS available in the process log
    // without capturing or re-encoding the mirrored frames.
    "fpsdisplaysink",
    `video-sink=\"${config.videoSink === "vaapisink" ? "vaapisink fullscreen=true" : "autovideosink"}\"`,
    "text-overlay=false",
    "silent=false",
    // Let the sink honor RTP timestamps and the local clock. The bounded
    // jitter buffer keeps the group within a few frames without promising
    // frame-perfect synchronization.
    "sync=true",
  ];
}

function validHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    /^[a-zA-Z0-9][a-zA-Z0-9.:-]*$/.test(value)
  );
}

function validDestination(destination: AirplayDestination): boolean {
  return (
    typeof destination.screenId === "string" &&
    validHost(destination.host) &&
    Number.isInteger(destination.port) &&
    destination.port === AIRPLAY_PORTS.videoRtp
  );
}

function validateConfig(config: ExternalPresentationConfig): void {
  if (
    config.provider !== "airplay" ||
    !config.sessionId ||
    config.receiverName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(config.receiverName) ||
    !isAirplayPin(config.pin) ||
    !isAirplayDeviceId(config.deviceId) ||
    !isAirplayProfile(config.profile) ||
    !Number.isInteger(config.videoPort) ||
    config.videoPort !== AIRPLAY_PORTS.videoRtp ||
    !["single", "gateway", "receiver"].includes(config.role)
  ) {
    throw new Error("invalid AirPlay session configuration");
  }
  if (isExpired(config.expiresAt))
    throw new Error("AirPlay session has expired");
  if (config.role === "receiver" && config.targetType !== "group") {
    throw new Error("an AirPlay receiver must belong to a group");
  }
  if (config.role === "single" && config.targetType !== "screen") {
    throw new Error("a single-screen AirPlay session must target a screen");
  }
  if (config.role === "gateway" && config.targetType !== "group") {
    throw new Error("a gateway must belong to a group");
  }
  if (config.transport === "multicast") {
    if (
      !config.multicastAddress ||
      !/^239\.255\.42\.(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(
        config.multicastAddress,
      )
    ) {
      throw new Error("invalid AirPlay multicast address");
    }
  }
  if (config.role === "gateway" || config.role === "single") {
    for (const destination of config.destinations) {
      if (!validDestination(destination))
        throw new Error("invalid AirPlay RTP destination");
    }
  }
}

function receiverPipeline(
  config: ExternalPresentationConfig,
  decoder: SupportedDecoder,
): string {
  // UxPlay parses this as a GStreamer pipeline fragment, not as a shell
  // command. Hosts are restricted above and spawn() never invokes a shell.
  if (config.transport === "multicast") {
    return `config-interval=1 ! udpsink host=${config.multicastAddress} port=${config.videoPort} auto-multicast=true`;
  }
  const clients = config.destinations
    .filter(validDestination)
    .map((destination) => `${destination.host}:${destination.port}`)
    .join(",");
  if (!clients) throw new Error("unicast AirPlay session has no destinations");
  return `config-interval=1 ! multiudpsink clients=${clients}`;
}

export class AirplayManager {
  private readonly store: StateStore;
  private readonly spawn: SpawnFunction;
  private readonly now: () => number;
  private readonly onStatus?: (
    status: ExternalPresentationStatus | null,
  ) => void;
  private config: ExternalPresentationConfig | null = null;
  private status: ExternalPresentationStatus | null = null;
  private uxplay: ManagedProcess | null = null;
  private receiver: ManagedProcess | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private receiverRestarts = 0;
  private gatewayRestarts = 0;
  private senderSeenAt: number | null = null;
  private receiverVideoSink: "vaapisink" | "autovideosink" = "autovideosink";
  private stopping = false;

  constructor(options: AirplayManagerOptions) {
    this.store = options.store;
    this.spawn = options.spawn ?? nodeSpawn;
    this.now = options.now ?? Date.now;
    this.onStatus = options.onStatus;
  }

  async probeCapabilities(): Promise<AirplayCapabilities> {
    const uxplay = await probeCommand(this.spawn, "uxplay", ["--version"]);
    const uxplayVersion = parseUxplayVersion(uxplay.output);
    const gstreamer = await probeCommand(this.spawn, "gst-inspect-1.0", [
      "--version",
    ]);
    const decoderChecks = await Promise.all(
      SUPPORTED_DECODERS.map(
        async (decoder) =>
          [
            decoder,
            (await probeCommand(this.spawn, "gst-inspect-1.0", [decoder])).ok,
          ] as const,
      ),
    );
    const decoderAvailability = Object.fromEntries(decoderChecks) as Record<
      SupportedDecoder,
      boolean
    >;
    const decoder = selectDecoder(decoderAvailability);
    const [vainfo, avahi, receiverSink, audioSink, fullscreenSink] =
      await Promise.all([
        probeCommand(this.spawn, "vainfo", []),
        probeCommand(this.spawn, "avahi-browse", [
          "--all",
          "--resolve",
          "--terminate",
        ]),
        probeCommand(this.spawn, "gst-inspect-1.0", ["fpsdisplaysink"]),
        probeCommand(this.spawn, "gst-inspect-1.0", ["autoaudiosink"]),
        probeCommand(this.spawn, "gst-inspect-1.0", ["vaapisink"]),
      ]);
    this.receiverVideoSink = fullscreenSink.ok ? "vaapisink" : "autovideosink";
    const gstreamerReady = gstreamer.ok && decoder !== null;
    const hardwarePlugin =
      decoder === "vah264dec" || decoder === "vaapih264dec";
    // A missing vainfo binary should not hide a hardware decoder plugin, but a
    // present binary that cannot initialize VA-API means the old box should be
    // treated as software-only until provisioning fixes its driver.
    const hardware =
      hardwarePlugin && (vainfo.ok || vainfo.output.trim().length === 0);
    const supported =
      uxplay.ok &&
      versionAtLeast(uxplayVersion, UXPLAY_BASELINE) &&
      gstreamerReady &&
      avahi.ok;
    const groupReceiverReady = gstreamerReady && receiverSink.ok;
    const maxProfile = !gstreamerReady
      ? "unsupported"
      : hardware
        ? "1080p30"
        : "720p30";
    return {
      airplaySupported: supported,
      uxplayInstalled: uxplay.ok,
      uxplayVersion,
      gstreamerInstalled: gstreamer.ok,
      h264DecoderAvailable: decoder !== null,
      hardwareH264Decode: hardware,
      decoder,
      maxProfile,
      // Followers only receive the forwarded RTP stream. They do not need a
      // second UxPlay advertiser or Avahi, while the gateway still must pass
      // the full airplaySupported check above.
      groupAirplaySupported: groupReceiverReady,
      audioAvailable: gstreamerReady && audioSink.ok,
      receiverVideoSink: this.receiverVideoSink,
      avahiAvailable: avahi.ok,
      mdnsAdvertisementAvailable: avahi.ok,
      multicastSupported: null,
      multicastTestStatus: "not_tested",
      limitation: !avahi.ok
        ? "Avahi/Bonjour support is unavailable; AirPlay cannot be advertised."
        : !hardware && decoder === "avdec_h264"
          ? "Intel VA-API H.264 decoding is unavailable; use 720p30 to limit CPU load."
          : hardwarePlugin && !hardware
            ? "A VA-API decoder plugin is installed but vainfo could not validate the driver; use 720p30 until the driver is fixed."
            : !vainfo.ok && supported
              ? "vainfo is unavailable; hardware decode was inferred from GStreamer plugins only."
              : undefined,
    };
  }

  async prepareSession(
    config: ExternalPresentationConfig,
    decoder: SupportedDecoder,
  ): Promise<ExternalPresentationStatus> {
    validateConfig(config);
    if (
      this.config &&
      (this.config.sessionId !== config.sessionId ||
        JSON.stringify(this.config) !== JSON.stringify(config))
    ) {
      // Reconfiguration (including multicast -> unicast fallback) must not
      // emit a transient null heartbeat that makes the server mark the same
      // session terminal between the old and new process set.
      await this.stopSessionInternal("replaced", false);
    }
    this.config = config;
    this.stopping = false;
    this.receiverRestarts = 0;
    this.gatewayRestarts = 0;
    this.senderSeenAt = null;
    try {
      await this.store.writeJson(SESSION_FILE, config);
      this.setStatus({
        provider: "airplay",
        sessionId: config.sessionId,
        role: config.role,
        state: "preparing",
        connected: false,
        receiverAlive: false,
        gatewayAlive: false,
      });
      if (config.role !== "single") {
        await this.startReceiver(config, decoder);
      }
      this.startTimers(decoder);
      this.setStatus({
        ...this.status!,
        state: "waiting",
        receiverAlive: config.role === "single" || this.receiver !== null,
      });
      return this.status!;
    } catch (error) {
      await this.stopSession("prepare_failed");
      throw error;
    }
  }

  async startGateway(
    decoder: SupportedDecoder,
  ): Promise<ExternalPresentationStatus> {
    const config = this.config;
    if (!config) throw new Error("AirPlay session is not prepared");
    if (config.role === "receiver") {
      throw new Error("A group receiver cannot advertise AirPlay");
    }
    validateConfig(config);
    if (this.uxplay) return this.status!;
    try {
      await this.startUxplay(config, decoder);
    } catch (error) {
      await this.stopSession("gateway_start_failed");
      throw error;
    }
    this.setStatus({
      ...this.status!,
      state: "waiting",
      gatewayAlive: true,
      receiverAlive: config.role === "single" || this.receiver !== null,
    });
    return this.status!;
  }

  async stopSession(reason = "stopped"): Promise<void> {
    await this.stopSessionInternal(reason, true);
  }

  private async stopSessionInternal(
    reason: string,
    notify: boolean,
  ): Promise<void> {
    this.stopping = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.healthTimer = null;
    this.expiryTimer = null;
    const processes = [this.uxplay, this.receiver].filter(
      Boolean,
    ) as ManagedProcess[];
    this.uxplay = null;
    this.receiver = null;
    await Promise.all(processes.map((managed) => this.stopProcess(managed)));
    this.config = null;
    this.status = null;
    await this.store.delete(SESSION_FILE).catch(() => undefined);
    log.info("AirPlay session stopped", { reason });
    if (notify) this.onStatus?.(null);
  }

  async recoverSession(
    decoder: SupportedDecoder | null,
  ): Promise<ExternalPresentationStatus | null> {
    const persisted =
      await this.store.readJson<ExternalPresentationConfig>(SESSION_FILE);
    if (!persisted) return null;
    if (isExpired(persisted.expiresAt)) {
      await this.store.delete(SESSION_FILE);
      return null;
    }
    if (!decoder) {
      log.warn("cannot recover AirPlay session without an H.264 decoder");
      await this.store.delete(SESSION_FILE);
      return null;
    }
    try {
      await this.prepareSession(persisted, decoder);
      if (persisted.role === "single" || persisted.role === "gateway") {
        await this.startGateway(decoder);
      }
    } catch (error) {
      log.warn("failed to reconstruct persisted AirPlay session", {
        error: String(error),
      });
      await this.stopSession("recovery_failed");
      return null;
    }
    return this.status;
  }

  getStatus(): ExternalPresentationStatus | null {
    return this.status ? { ...this.status } : null;
  }

  getConfig(): ExternalPresentationConfig | null {
    return this.config
      ? { ...this.config, destinations: [...this.config.destinations] }
      : null;
  }

  private startTimers(decoder: SupportedDecoder): void {
    if (!this.healthTimer) {
      this.healthTimer = setInterval(() => {
        void this.healthCheck(decoder);
      }, HEALTH_INTERVAL_MS);
      this.healthTimer.unref?.();
    }
    this.scheduleExpiry();
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const config = this.config;
    if (!config) return;
    const delay = Math.max(0, Date.parse(config.expiresAt) - this.now());
    this.expiryTimer = setTimeout(
      () => {
        if (this.config && isExpired(this.config.expiresAt, this.now())) {
          void this.stopSession("expired");
        } else {
          this.scheduleExpiry();
        }
      },
      Math.min(delay + 25, 2_147_000_000),
    );
    this.expiryTimer.unref?.();
  }

  private async startUxplay(
    config: ExternalPresentationConfig,
    decoder: SupportedDecoder,
  ): Promise<void> {
    const profile = profileDimensions(config.profile);
    const args = [
      "-n",
      config.receiverName,
      "-nh",
      "-pin",
      config.pin,
      "-m",
      config.deviceId,
      "-p",
      AIRPLAY_PORTS.uxplay.join(","),
      "-s",
      `${profile.width}x${profile.height}`,
      "-fps",
      String(profile.fps),
      "-nofreeze",
      "-scrsv",
      "2",
      "-FPSdata",
    ];
    if (config.audioMode === "none") {
      // UxPlay's documented -as 0 path suppresses streamed audio without
      // touching the compressed video path.
      args.push("-as", "0");
    }
    if (config.role === "single") {
      args.push("-vd", decoder, "-fs");
    } else {
      // Group mode must never decode or render on the gateway. UxPlay forwards
      // decrypted compressed H.264 RTP packets to the receivers.
      args.push("-vs", "0", "-vrtp", receiverPipeline(config, decoder));
    }
    const child = this.spawn("uxplay", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const managed: ManagedProcess = { child, kind: "uxplay", stopping: false };
    this.uxplay = managed;
    this.attachOutput(managed);
    child.once("error", (error) => {
      if (this.uxplay?.child !== child || managed.stopping || this.stopping)
        return;
      log.warn("UxPlay process failed to start or exited with an error", {
        error: String(error),
      });
      void this.handleGatewayExit(decoder);
    });
    child.once("exit", () => {
      if (this.uxplay?.child !== child) return;
      this.uxplay = null;
      if (!managed.stopping && !this.stopping)
        void this.handleGatewayExit(decoder);
    });
  }

  private async startReceiver(
    config: ExternalPresentationConfig,
    decoder: SupportedDecoder,
  ): Promise<void> {
    if (this.receiver) return;
    const child = this.spawn(
      "gst-launch-1.0",
      buildReceiverArgs({
        ...config,
        decoder,
        videoSink: this.receiverVideoSink,
      }),
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const managed: ManagedProcess = {
      child,
      kind: "receiver",
      stopping: false,
    };
    this.receiver = managed;
    this.attachOutput(managed);
    child.once("error", (error) => {
      if (this.receiver?.child !== child || managed.stopping || this.stopping)
        return;
      log.warn("GStreamer receiver failed to start or exited with an error", {
        error: String(error),
      });
      void this.handleReceiverExit(decoder);
    });
    child.once("exit", () => {
      if (this.receiver?.child !== child) return;
      this.receiver = null;
      if (!managed.stopping && !this.stopping)
        void this.handleReceiverExit(decoder);
    });
  }

  private attachOutput(managed: ManagedProcess): void {
    const read = (chunk: Buffer | string) => {
      const text = String(chunk);
      const lower = text.toLowerCase();
      if (managed.kind === "uxplay") {
        if (/fps|frames?\s*\/|streaming|mirroring/.test(lower)) {
          const current = this.status;
          if (current) {
            if (current.role !== "single") this.senderSeenAt = this.now();
            this.setStatus({
              ...current,
              // In group mode UxPlay proving that it has a sender is not
              // enough: the gateway's own forwarded RTP receiver must also
              // render a packet before the display is marked connected.
              state: current.role === "single" ? "connected" : current.state,
              connected: current.role === "single" ? true : current.connected,
              gatewayAlive: true,
              lastRtpAt:
                current.role === "single"
                  ? new Date(this.now()).toISOString()
                  : current.lastRtpAt,
            });
          }
        }
        if (
          /teardown|disconnected|stop mirroring|connection closed/.test(lower)
        ) {
          void this.handleSenderDisconnect();
        }
      }
      if (
        managed.kind === "receiver" &&
        /rendered:\s*[1-9][0-9]*/.test(lower)
      ) {
        const current = this.status;
        if (current) {
          this.setStatus({
            ...current,
            state: "connected",
            connected: true,
            lastRtpAt: new Date(this.now()).toISOString(),
          });
        }
      }
      if (/error|missing plugin|could not link|not-negotiated/.test(lower)) {
        log.warn("AirPlay process reported an error", {
          process: managed.kind,
          message: text.trim().slice(0, 240),
        });
        const current = this.status;
        if (current) {
          this.setStatus({
            ...current,
            state: "degraded",
            failureCode: "process_error",
            failureMessage: "An AirPlay media process reported an error.",
          });
        }
      }
    };
    managed.child.stdout?.on("data", read);
    managed.child.stderr?.on("data", read);
  }

  private async handleSenderDisconnect(): Promise<void> {
    const current = this.status;
    if (!current || this.stopping) return;
    this.setStatus({
      ...current,
      state: "waiting",
      connected: false,
      lastRtpAt: undefined,
    });
    this.senderSeenAt = null;
    if (this.config?.role !== "single" && this.receiver) {
      // Closing the receiver window removes the stale last frame. A new
      // receiver waits behind the Tilecast ready surface for the next sender.
      const old = this.receiver;
      this.receiver = null;
      await this.stopProcess(old);
      const decoder = await this.decoderForRecovery();
      if (decoder && this.config && !this.stopping)
        await this.startReceiver(this.config, decoder);
    }
  }

  private async handleGatewayExit(decoder: SupportedDecoder): Promise<void> {
    const current = this.status;
    if (!current || this.stopping) return;
    if (current.connected || this.gatewayRestarts >= MAX_PROCESS_RESTARTS) {
      await this.stopSession("gateway_failed");
      return;
    }
    this.gatewayRestarts += 1;
    this.setStatus({
      ...current,
      state: "degraded",
      gatewayAlive: false,
      failureCode: "uxplay_waiting_crash",
      failureMessage:
        "UxPlay stopped before a sender connected; restarting it.",
    });
    if (this.config && !this.stopping)
      await this.startUxplay(this.config, decoder);
  }

  private async handleReceiverExit(decoder: SupportedDecoder): Promise<void> {
    const current = this.status;
    if (!current || this.stopping) return;
    if (current.role === "gateway" && current.connected) {
      await this.stopSession("gateway_receiver_failed");
      return;
    }
    if (this.receiverRestarts >= MAX_PROCESS_RESTARTS) {
      if (current.role === "gateway") {
        await this.stopSession("gateway_receiver_failed");
        return;
      }
      this.setStatus({
        ...current,
        state: "degraded",
        receiverAlive: false,
        failureCode: "receiver_failed",
        failureMessage: "The display receiver failed repeatedly.",
      });
      return;
    }
    this.receiverRestarts += 1;
    this.setStatus({
      ...current,
      state: "degraded",
      receiverAlive: false,
      failureCode: "receiver_restart",
      failureMessage:
        "The display receiver stopped; attempting a bounded restart.",
    });
    if (this.config && !this.stopping)
      await this.startReceiver(this.config, decoder);
  }

  private async healthCheck(decoder: SupportedDecoder): Promise<void> {
    const config = this.config;
    const current = this.status;
    if (!config || !current || this.stopping) return;
    if (isExpired(config.expiresAt, this.now())) {
      await this.stopSession("expired");
      return;
    }
    const gatewayAlive = config.role !== "receiver" && this.uxplay !== null;
    const receiverAlive = config.role === "single" || this.receiver !== null;
    if (
      gatewayAlive !== current.gatewayAlive ||
      receiverAlive !== current.receiverAlive
    ) {
      this.setStatus({ ...current, gatewayAlive, receiverAlive });
    }
    if (current.connected && current.lastRtpAt) {
      const age = this.now() - Date.parse(current.lastRtpAt);
      if (age > 5_000) await this.handleSenderDisconnect();
    }
    if (
      config.role === "gateway" &&
      this.senderSeenAt !== null &&
      !current.connected &&
      this.now() - this.senderSeenAt > 5_000
    ) {
      this.setStatus({
        ...current,
        state: "degraded",
        failureCode: "gateway_rtp_timeout",
        failureMessage:
          "UxPlay has a sender, but the gateway display has not received RTP.",
      });
      if (config.transport !== "multicast") {
        await this.stopSession("gateway_rtp_timeout");
      }
    }
  }

  private async decoderForRecovery(): Promise<SupportedDecoder | null> {
    const capabilities = await this.probeCapabilities();
    return capabilities.decoder as SupportedDecoder | null;
  }

  private async stopProcess(managed: ManagedProcess): Promise<void> {
    managed.stopping = true;
    if (managed.child.exitCode !== null || managed.child.signalCode !== null)
      return;
    managed.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        managed.child.kill("SIGKILL");
        resolve();
      }, 2_000);
      managed.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private setStatus(status: ExternalPresentationStatus): void {
    this.status = { ...status };
    this.onStatus?.(this.status);
  }
}

export type { SupportedDecoder };
