/**
 * Player runtime orchestrator.
 *
 * Owns the full device lifecycle: identity verification, pairing, the
 * socket/reconnect loop, manifest/config/command synchronization, playlist
 * selection, item-boundary manifest activation, emergency takeover, status
 * reporting, and the self-heal supervisor. Platform actions (windows,
 * renderer, relaunch) are behind the PlayerHost interface so the runtime
 * logic is independent of Electron.
 *
 * Reliability posture, in one place:
 *  - cached manifest and config apply at boot with zero network
 *  - the stored credential is sent only after the server's installation ID
 *    is verified, and cleared only on a confirmed invalid/revoked answer
 *  - socket reconnect uses jittered backoff that resets after health
 *  - commands poll on a timer independent of socket state
 *  - manifest reconciles on a timer independent of push notifications
 *  - a prepared manifest activates at the next item boundary; an active
 *    emergency interrupts immediately once prepared
 *  - playback health is judged by renderer-reported progress, with a
 *    persisted escalation ladder and safe mode behind it
 */

import { randomUUID } from "crypto";
import { ApiClient, ApiError, NetworkError } from "./api";
import { ActivityReporter } from "./activity";
import { ReconnectBackoff } from "./backoff";
import { CommandCoordinator } from "./commands";
import { ConfigSync } from "./config";
import { LivePreview, type PreviewHost } from "./preview";
import { logger } from "./log";
import { ManifestSync } from "./manifest";
import {
  buildDeviceMetadata,
  clearCredential,
  loadCredential,
  loadOrCreateInstallationId,
  pairUntilEnrolled,
  type CredentialRecord,
} from "./pairing";
import {
  emergencyActive,
  findPlaylist,
  resolveSelection,
  type Selection,
} from "./schedule";
import { PlayerSocket } from "./socket";
import { activeHoursFromConfig, evaluateActiveHours } from "./active-hours";
import { renderWidget } from "./widget-render";
import { renderLayout } from "./layout-render";
import type {
  ManifestDataSource,
  ManifestLayout,
  ManifestWidget,
} from "./content-types";
import type { LayoutRenderPayload, WidgetRenderPayload } from "./render-tree";
import type { StateStore } from "./storage";
import {
  DEFAULT_SUPERVISOR_CONFIG,
  clearSafeMode,
  evaluate,
  initialSupervisorState,
  onProgress,
  type HealAction,
  type SupervisorState,
} from "./supervisor";
import type {
  CommandResultReport,
  Heartbeat,
  Manifest,
  ManifestItem,
  ManifestPlaylist,
  PlayerCommand,
  PlayerConfig,
} from "./types";

const log = logger("player");

const SUPERVISOR_FILE = "supervisor-state.json";
const PLAYBACK_FLAGS_FILE = "playback-flags.json";
const SELECTION_EVAL_INTERVAL_MS = 30_000;
const SUPERVISOR_TICK_MS = 15_000;
const DEFAULT_STATUS_INTERVAL_S = 60;

export interface PresentationItem {
  id: string;
  kind: "image" | "video" | "website" | "widget" | "layout" | "youtube";
  /** tcmedia:// URL for media, https page URL for websites/youtube. */
  src: string;
  durationMs: number | null;
  fitMode: string;
  audioEnabled: boolean;
  volume: number;
  videoStartOffsetMs: number | null;
  videoEndOffsetMs: number | null;
  website?: {
    loadTimeoutSeconds: number;
    refreshIntervalSeconds: number | null;
    zoomPercent: number;
    backgroundColor: string;
    failureBehavior: string;
    fallbackSrc: string | null;
    allowedHosts: string[];
  };
  /** Pre-resolved render tree for widget / declarative-presentation items. */
  widget?: WidgetRenderPayload;
  /** Pre-resolved multi-zone layout. */
  layout?: LayoutRenderPayload;
}

export type Presentation =
  | { state: "setup" }
  | {
      state: "pairing";
      code: string;
      approvalUrl: string;
      organizationName?: string;
    }
  | { state: "idle"; title: string; message: string }
  | { state: "disabled"; title: string; message: string }
  | { state: "safe-mode"; reason: string }
  | { state: "sleep" }
  | {
      state: "playing";
      items: PresentationItem[];
      emergency: boolean;
      generation: number;
    };

export interface PlayerHost {
  /** Replace what the renderer is showing. */
  present(presentation: Presentation): void;
  /** Show a transient identify overlay. */
  identify(name: string, durationSeconds: number): void;
  /** Recreate the renderer view (heal rung / command). */
  recreateRenderer(): void;
  /** Recreate the whole kiosk window (heal rung). */
  recreateWindow(): void;
  /** Relaunch the entire process (heal rung / restart commands). */
  restartProcess(): void;
  /** Clear website renderer storage. */
  clearWebsiteData(): Promise<void>;
  /** Ask the renderer to retry or skip the current item. */
  retryCurrentItem(): void;
  skipCurrentItem(): void;
  screenSize(): { width: number; height: number };
  availableStorageBytes(): Promise<number | null>;
  /** Capture the window for live preview, downscaled within limits. Returns
   * null in states that must not be uploaded (the runtime also gates this). */
  capturePreview(max: {
    width: number;
    height: number;
    bytes: number;
  }): Promise<{ jpeg: Buffer; width: number; height: number } | null>;
}

interface PlaybackFlags {
  playbackDisabled: boolean;
}

export interface PlayerRuntimeOptions {
  serverUrl: string;
  playerVersion: string;
  fetchImpl?: typeof fetch;
}

export class PlayerRuntime {
  private client: ApiClient;
  private manifestSync: ManifestSync;
  private configSync: ConfigSync;
  private commands: CommandCoordinator | null = null;
  private activity: ActivityReporter | null = null;
  private preview: LivePreview | null = null;
  private socket: PlayerSocket | null = null;
  private readonly backoff = new ReconnectBackoff({
    baseDelayMs: 2_000,
    maxDelayMs: 5 * 60_000,
    healthyResetMs: 2 * 60_000,
  });

  private credential: CredentialRecord | null = null;
  private installationId = "";
  private config: PlayerConfig | null = null;

  private activeManifest: Manifest | null = null;
  private pendingManifest: Manifest | null = null;
  private selection: Selection | null = null;
  private generation = 0;
  private currentItemId: string | null = null;
  private playbackState = "starting";
  private lastPlaybackError: string | null = null;
  private websiteRecoveryCount = 0;

  private supervisorState: SupervisorState = initialSupervisorState(Date.now());
  private flags: PlaybackFlags = { playbackDisabled: false };
  private lastCommand: {
    id: string;
    state: string;
    result: string;
    completedAt: string;
  } | null = null;

  private timers: NodeJS.Timeout[] = [];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private socketOpen = false;
  private readonly startedAt = Date.now();

  constructor(
    private readonly store: StateStore,
    private readonly host: PlayerHost,
    private readonly options: PlayerRuntimeOptions,
  ) {
    this.client = new ApiClient(
      options.serverUrl,
      null,
      options.fetchImpl ?? fetch,
    );
    this.manifestSync = new ManifestSync(this.store, this.client, {
      onManifestPrepared: (manifest) => this.onManifestPrepared(manifest),
      onCredentialRejected: () => void this.onCredentialRejected(),
      onSyncError: (error) => log.warn("manifest sync error", { error }),
    });
    this.configSync = new ConfigSync(this.store, this.client, {
      onConfigApplied: (config) => {
        this.config = config;
      },
      onCredentialRejected: () => void this.onCredentialRejected(),
    });
  }

  // -------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    await this.store.init();
    this.installationId = await loadOrCreateInstallationId(this.store);
    this.supervisorState =
      (await this.store.readJson<SupervisorState>(SUPERVISOR_FILE)) ??
      initialSupervisorState(Date.now());
    this.flags = (await this.store.readJson<PlaybackFlags>(
      PLAYBACK_FLAGS_FILE,
    )) ?? {
      playbackDisabled: false,
    };

    this.credential = await loadCredential(this.store);
    if (
      this.credential &&
      this.credential.serverUrl !== this.options.serverUrl
    ) {
      // Server address was reconfigured; the old credential targets another
      // installation and must not be sent to the new address.
      log.warn("server url changed; existing credential does not apply");
      this.credential = null;
    }

    if (this.credential) {
      this.client.setCredential(this.credential.deviceCredential);
      await this.runPaired();
    } else {
      await this.runPairing();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.socket?.close();
    this.manifestSync.stop();
    this.commands?.stop();
    this.activity?.stop();
    this.preview?.stop();
  }

  // ---------------------------------------------------------------- pairing

  private async runPairing(): Promise<void> {
    const identity = await this.waitForVerifiedIdentity(null);
    const size = this.host.screenSize();
    const metadata = buildDeviceMetadata({
      playerInstallationId: this.installationId,
      playerVersion: this.options.playerVersion,
      screenWidth: size.width,
      screenHeight: size.height,
    });

    const credential = await pairUntilEnrolled(
      this.store,
      this.client,
      identity.installationId,
      metadata,
      {
        onWaitingForApproval: (progress) => {
          this.host.present({
            state: "pairing",
            code: progress.code,
            approvalUrl: progress.approvalUrl,
            organizationName: progress.organizationName,
          });
        },
        onSessionEnded: (reason) => {
          log.info("pairing session ended", { reason });
        },
      },
      (ms) => this.sleep(ms),
    );

    this.credential = credential;
    this.client.setCredential(credential.deviceCredential);
    await this.runPaired();
  }

  /**
   * A configured player verifies the installation ID before sending any
   * stored device credential. Network failure retries forever; a mismatch
   * (for a paired player) keeps the credential safe and keeps retrying —
   * cached playback continues meanwhile.
   */
  private async waitForVerifiedIdentity(expected: string | null) {
    for (;;) {
      try {
        const identity = await this.client.identity();
        if (expected && identity.installationId !== expected) {
          log.error("installation identity mismatch; withholding credential", {
            expected,
            actual: identity.installationId,
          });
          await this.sleep(60_000);
          continue;
        }
        return identity;
      } catch (err) {
        log.warn("identity fetch failed; retrying", { error: String(err) });
        await this.sleep(err instanceof NetworkError ? 5_000 : 15_000);
      }
    }
  }

  // ----------------------------------------------------------------- paired

  private identityVerified = false;

  private async runPaired(): Promise<void> {
    // Cached content and configuration first — playback never waits for the
    // network. These emit onManifestPrepared/onConfigApplied from disk and
    // send nothing over the wire.
    await this.configSync.loadCached();
    await this.manifestSync.loadCached();

    this.timers.push(
      setInterval(
        () => this.evaluatePresentation(),
        SELECTION_EVAL_INTERVAL_MS,
      ),
      setInterval(() => void this.supervisorTick(), SUPERVISOR_TICK_MS),
      setInterval(
        () => void this.reportStatus(),
        this.statusIntervalSeconds() * 1_000,
      ),
      // Config piggybacks on the manifest reconcile cadence.
      setInterval(
        () => void this.configSync.syncNow("reconcile-timer"),
        5 * 60_000,
      ),
    );

    this.commands = new CommandCoordinator(
      this.store,
      this.client,
      this.buildCommandHandlers(),
      new Set(["restart_player_process", "restart_activity"]),
      () => this.host.restartProcess(),
      {
        onCredentialRejected: () => void this.onCredentialRejected(),
        onPollError: (error) => log.debug("command poll error", { error }),
        onCommandCompleted: (command, result) => {
          this.lastCommand = {
            id: command.id,
            state: result.success ? "succeeded" : "failed",
            result: result.code,
            completedAt: new Date().toISOString(),
          };
        },
      },
    );

    // Identity gate: no stored credential leaves this device until the
    // server proves it is the installation we enrolled with. Cached playback
    // is already running above; this only delays network features.
    await this.waitForVerifiedIdentity(this.credential!.installationId);
    this.identityVerified = true;

    this.activity = new ActivityReporter(
      this.store,
      this.client,
      () => Date.now(),
      () => randomUUID(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    await this.activity.start();

    this.preview = new LivePreview(
      this.client,
      {
        capture: (max) =>
          // Protected states never upload an image.
          this.playbackState === "pairing" ||
          this.playbackState === "setup" ||
          this.supervisorState.safeMode
            ? Promise.resolve(null)
            : this.host.capturePreview(max),
        playerVersion: this.options.playerVersion,
      } satisfies PreviewHost,
      () => Date.now(),
    );
    this.preview.start();

    await this.configSync.syncNow("startup");
    await this.manifestSync.start();
    await this.commands.start();
    this.connectSocket();
  }

  private connectSocket(): void {
    if (this.stopped || !this.credential) {
      return;
    }
    const socketUrl =
      this.options.serverUrl.replace(/^http/, "ws").replace(/\/+$/, "") +
      "/api/v1/player/socket";
    this.socket = new PlayerSocket(
      socketUrl,
      this.credential.deviceCredential,
      this.options.playerVersion,
      {
        onOpen: () => {
          const wasDown = !this.socketOpen && this.backoff.failureStreak > 0;
          this.socketOpen = true;
          this.backoff.onConnected(Date.now());
          log.info("connected");
          if (wasDown) {
            void this.activity?.record({
              eventType: "connection.recovered",
              category: "connectivity",
              result: "recovered",
            });
          }
          // Reconcile everything immediately: any push lost while offline is
          // recovered right here.
          void this.manifestSync.syncNow("socket-open");
          void this.configSync.syncNow("socket-open");
          void this.commands?.pollNow("socket-open");
          void this.reportStatus();
        },
        onClose: (reason, policyViolation) => {
          const wasOpen = this.socketOpen;
          this.socketOpen = false;
          const delay = this.backoff.onDisconnected(Date.now());
          log.warn("socket closed", { reason, retryInMs: delay });
          if (wasOpen) {
            void this.activity?.record({
              eventType: "connection.lost",
              category: "connectivity",
              severity: "warning",
              failureMessage: reason,
            });
          }
          if (policyViolation) {
            // Revoked or disabled — an authenticated HTTP call decides which
            // (only a confirmed invalid/revoked clears the credential).
            void this.probeCredential();
          }
          if (!this.stopped) {
            this.reconnectTimer = setTimeout(() => this.connectSocket(), delay);
          }
        },
        onManifestChanged: () => void this.manifestSync.syncNow("push"),
        onConfigChanged: () => void this.configSync.syncNow("push"),
        onCommandsAvailable: () => void this.commands?.pollNow("push"),
      },
    );
    this.socket.connect();
  }

  /** Distinguish revoked credential from a merely disabled screen. */
  private async probeCredential(): Promise<void> {
    try {
      await this.client.fetchCommands();
    } catch (err) {
      if (err instanceof ApiError && err.credentialRejected) {
        await this.onCredentialRejected();
      } else if (err instanceof ApiError && err.screenDisabled) {
        log.info("screen is administratively disabled");
      }
    }
  }

  private async onCredentialRejected(): Promise<void> {
    if (!this.credential) {
      return;
    }
    log.error("device credential confirmed invalid or revoked; re-pairing");
    this.credential = null;
    this.client.setCredential(null);
    await clearCredential(this.store);
    // Relaunch into a clean pairing state rather than juggling half-stopped
    // sync loops in-process. The relaunched player shows the pairing code and
    // needs only a Studio approval — never a visit to the device.
    this.host.restartProcess();
  }

  // ------------------------------------------------------------- activation

  private onManifestPrepared(manifest: Manifest): void {
    const emergencyNow = emergencyActive(manifest, new Date());
    if (
      this.activeManifest === null ||
      this.playbackState !== "playing" ||
      emergencyNow
    ) {
      // Nothing on screen yet, or an emergency: activate immediately.
      this.activeManifest = manifest;
      this.pendingManifest = null;
      this.evaluatePresentation(true);
      return;
    }
    // Seamless: hold until the next item boundary.
    this.pendingManifest = manifest;
    log.info("manifest prepared; will activate at next item boundary", {
      manifestVersion: manifest.manifestVersion,
    });
  }

  /** Renderer reported an item boundary. */
  onItemBoundary(): void {
    if (this.pendingManifest) {
      this.activeManifest = this.pendingManifest;
      this.pendingManifest = null;
      log.info("activated pending manifest at item boundary", {
        manifestVersion: this.activeManifest.manifestVersion,
      });
      this.evaluatePresentation(true);
    }
  }

  /** Renderer progress: item transitions, video advancement, image shown. */
  onPlaybackProgress(itemId: string | null, kind: string): void {
    this.currentItemId = itemId;
    this.supervisorState = onProgress(
      this.supervisorState,
      Date.now(),
      DEFAULT_SUPERVISOR_CONFIG,
    );
    if (kind === "item-transition") {
      void this.activity?.record({
        eventType: "content.completed",
        category: "playback",
        result: "completed",
        contentId: itemId ?? undefined,
        playlistItemId: itemId ?? undefined,
        trigger: this.selection?.source,
        scheduleId: this.selection?.scheduleId ?? undefined,
        emergencyId: this.selection?.emergencyId ?? undefined,
        manifestVersion: this.activeManifest?.manifestVersion,
      });
      this.onItemBoundary();
    }
  }

  onPlaybackError(itemId: string | null, message: string): void {
    this.lastPlaybackError = message.slice(0, 240);
    log.warn("playback error reported", { itemId, message });
    void this.activity?.record({
      eventType: "content.failed",
      category: "playback",
      severity: "error",
      result: "failed",
      contentId: itemId ?? undefined,
      playlistItemId: itemId ?? undefined,
      failureMessage: message,
      manifestVersion: this.activeManifest?.manifestVersion,
    });
  }

  onWebsiteRecovered(): void {
    this.websiteRecoveryCount += 1;
  }

  /** Recompute what should be on screen; presents only when it changed. */
  evaluatePresentation(force = false): void {
    const next = this.buildPresentation();
    const key = JSON.stringify(next);
    if (!force && key === this.lastPresentedKey) {
      return;
    }
    this.lastPresentedKey = key;
    if (next.state === "playing") {
      this.generation += 1;
      this.playbackState = "playing";
      this.host.present({ ...next, generation: this.generation });
    } else {
      this.playbackState = next.state;
      this.host.present(next);
    }
  }
  private lastPresentedKey = "";

  private buildPresentation(): Presentation {
    if (this.supervisorState.safeMode) {
      return {
        state: "safe-mode",
        reason: this.supervisorState.safeModeReason ?? "repeated failures",
      };
    }

    const manifest = this.activeManifest;
    const branding = this.config?.branding ?? {};
    const emergencyNow =
      manifest !== null && emergencyActive(manifest, new Date());

    // Outside active hours the screen rests (true black), unless an emergency
    // is active — emergency always overrides off-hours sleep.
    if (!emergencyNow) {
      const activeHours = activeHoursFromConfig(this.config?.power);
      if (!evaluateActiveHours(activeHours, new Date()).active) {
        return { state: "sleep" };
      }
    }

    if (this.flags.playbackDisabled && !emergencyNow) {
      return {
        state: "disabled",
        title: String(branding["disabledTitle"] ?? "Screen disabled"),
        message: String(branding["disabledMessage"] ?? ""),
      };
    }

    if (!manifest) {
      return {
        state: "idle",
        title: String(branding["noContentTitle"] ?? "Waiting for content"),
        message: String(branding["noContentMessage"] ?? ""),
      };
    }

    this.selection = resolveSelection(manifest, new Date());

    // A directly-assigned or scheduled Layout: render it as a single
    // fullscreen presentation item.
    if (this.selection.layoutId && !this.selection.playlistId) {
      const layoutItem = this.buildItem(manifest, {
        id: `layout-${this.selection.layoutId}`,
        assetId: "",
        layoutId: this.selection.layoutId,
        assetType: "layout",
        fitMode: "contain",
        transition: "none",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "download",
      } as ManifestItem);
      if (layoutItem) {
        return {
          state: "playing",
          items: [layoutItem],
          emergency: false,
          generation: this.generation,
        };
      }
    }

    const playlist = findPlaylist(manifest, this.selection.playlistId);
    if (!playlist || playlist.items.length === 0) {
      return {
        state: "idle",
        title: String(branding["noContentTitle"] ?? "Waiting for content"),
        message: String(branding["noContentMessage"] ?? ""),
      };
    }

    const items = this.buildItems(manifest, playlist);
    if (items.length === 0) {
      return {
        state: "idle",
        title: String(branding["noContentTitle"] ?? "Waiting for content"),
        message: "No renderable items in the assigned playlist",
      };
    }
    return {
      state: "playing",
      items,
      emergency: this.selection.source === "emergency",
      generation: this.generation,
    };
  }

  private buildItems(
    manifest: Manifest,
    playlist: ManifestPlaylist,
  ): PresentationItem[] {
    const items: PresentationItem[] = [];
    for (const item of playlist.items) {
      const built = this.buildItem(manifest, item);
      if (built) {
        items.push(built);
      }
    }
    return items;
  }

  /** Widget/data-source/layout lookup maps, rebuilt when the manifest swaps. */
  private lookup: {
    manifestVersion: number;
    widgets: Map<string, ManifestWidget>;
    dataSources: Map<string, ManifestDataSource>;
    layouts: Map<string, ManifestLayout>;
  } | null = null;

  private lookups(manifest: Manifest): NonNullable<PlayerRuntime["lookup"]> {
    if (
      this.lookup &&
      this.lookup.manifestVersion === manifest.manifestVersion
    ) {
      return this.lookup;
    }
    const widgets = new Map<string, ManifestWidget>();
    for (const w of (manifest.widgets ?? []) as ManifestWidget[]) {
      widgets.set(w.assetId, w);
    }
    const dataSources = new Map<string, ManifestDataSource>();
    for (const s of (manifest.dataSources ?? []) as ManifestDataSource[]) {
      dataSources.set(s.id, s);
    }
    const layouts = new Map<string, ManifestLayout>();
    for (const l of (manifest.layouts ?? []) as ManifestLayout[]) {
      layouts.set(l.id, l);
    }
    if (manifest.layout) {
      const rootLayout = manifest.layout as unknown as ManifestLayout;
      layouts.set(rootLayout.id, rootLayout);
    }
    this.lookup = {
      manifestVersion: manifest.manifestVersion,
      widgets,
      dataSources,
      layouts,
    };
    return this.lookup;
  }

  private buildItem(
    manifest: Manifest,
    item: ManifestItem,
  ): PresentationItem | null {
    const maps = this.lookups(manifest);

    if (item.layoutId) {
      const layout = maps.layouts.get(item.layoutId);
      if (!layout) {
        return null;
      }
      const payload = renderLayout(layout.document, {
        manifest,
        widgets: maps.widgets,
        dataSources: maps.dataSources,
        at: new Date(),
      });
      if (!payload) {
        return null; // invalid layout: skip this item, keep the rest
      }
      return {
        id: item.id,
        kind: "layout",
        src: "",
        durationMs: item.durationMs ?? 30_000,
        fitMode: item.fitMode,
        audioEnabled: item.audioEnabled,
        volume: item.volume,
        videoStartOffsetMs: null,
        videoEndOffsetMs: null,
        layout: payload,
      };
    }

    // Widget item: the item's assetId references a manifest widget.
    const widget = maps.widgets.get(item.assetId);
    if (widget) {
      if (widget.provider === "youtube") {
        return this.buildYouTubeItem(item, widget);
      }
      const payload = renderWidget(widget, {
        dataSources: maps.dataSources,
        at: new Date(),
      });
      if (!payload) {
        return null;
      }
      return {
        id: item.id,
        kind: "widget",
        src: "",
        durationMs: item.durationMs ?? 30_000,
        fitMode: item.fitMode,
        audioEnabled: item.audioEnabled,
        volume: item.volume,
        videoStartOffsetMs: null,
        videoEndOffsetMs: null,
        widget: payload,
      };
    }

    if (item.assetType === "website") {
      const website = (manifest.websites ?? []).find(
        (w) => w.assetId === item.assetId,
      );
      if (!website) {
        return null;
      }
      let fallbackSrc: string | null = null;
      if (website.fallbackImageAssetId) {
        const fallbackAsset = manifest.assets.find(
          (a) =>
            a.assetId === website.fallbackImageAssetId &&
            (!website.fallbackVariantId ||
              a.variantId === website.fallbackVariantId),
        );
        if (fallbackAsset) {
          fallbackSrc = `tcmedia://variant/${fallbackAsset.assetId}/${fallbackAsset.variantId}`;
        }
      }
      return {
        id: item.id,
        kind: "website",
        src: website.url,
        durationMs: item.durationMs ?? 60_000,
        fitMode: item.fitMode,
        audioEnabled: item.audioEnabled,
        volume: item.volume,
        videoStartOffsetMs: null,
        videoEndOffsetMs: null,
        website: {
          loadTimeoutSeconds: website.loadTimeoutSeconds,
          refreshIntervalSeconds: website.refreshIntervalSeconds ?? null,
          zoomPercent: website.zoomPercent,
          backgroundColor: website.backgroundColor,
          failureBehavior: website.failureBehavior,
          fallbackSrc,
          allowedHosts: website.allowedHosts,
        },
      };
    }

    const asset = manifest.assets.find(
      (a) => a.assetId === item.assetId && a.variantId === item.variantId,
    );
    if (!asset) {
      return null;
    }
    const kind = asset.mimeType.startsWith("video/")
      ? "video"
      : asset.mimeType.startsWith("image/")
        ? "image"
        : null;
    if (!kind) {
      return null;
    }
    return {
      id: item.id,
      kind,
      src: `tcmedia://variant/${asset.assetId}/${asset.variantId}`,
      durationMs: item.durationMs ?? (kind === "image" ? 10_000 : null),
      fitMode: item.fitMode,
      audioEnabled: item.audioEnabled,
      volume: item.volume,
      videoStartOffsetMs: item.videoStartOffsetMs ?? null,
      videoEndOffsetMs: item.videoEndOffsetMs ?? null,
    };
  }

  /**
   * YouTube widget → a website item pointed at the privacy-preserving
   * youtube-nocookie embed. Uses the stream delivery path (requires
   * connectivity); a fallback image shows on failure like any website.
   */
  private buildYouTubeItem(
    item: ManifestItem,
    widget: ManifestWidget,
  ): PresentationItem | null {
    const config = widget.configuration ?? {};
    const videoId = String(config["videoId"] ?? config["video"] ?? "");
    const playlistId = String(config["playlistId"] ?? config["playlist"] ?? "");
    if (!videoId && !playlistId) {
      return null;
    }
    const params = new URLSearchParams({
      autoplay: "1",
      controls: "0",
      rel: "0",
      modestbranding: "1",
      mute: item.audioEnabled ? "0" : "1",
      loop: "1",
    });
    if (config["startSeconds"]) {
      params.set("start", String(config["startSeconds"]));
    }
    if (config["endSeconds"]) {
      params.set("end", String(config["endSeconds"]));
    }
    let url: string;
    if (playlistId) {
      params.set("listType", "playlist");
      params.set("list", playlistId);
      url = `https://www.youtube-nocookie.com/embed?${params.toString()}`;
    } else {
      params.set("playlist", videoId); // required for single-video loop
      url = `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
    }
    return {
      id: item.id,
      kind: "youtube",
      src: url,
      durationMs: item.durationMs ?? null,
      fitMode: "cover",
      audioEnabled: item.audioEnabled,
      volume: item.volume,
      videoStartOffsetMs: null,
      videoEndOffsetMs: null,
      website: {
        loadTimeoutSeconds: 20,
        refreshIntervalSeconds: null,
        zoomPercent: 100,
        backgroundColor: "#000000",
        failureBehavior: "placeholder",
        fallbackSrc: null,
        allowedHosts: [
          "www.youtube-nocookie.com",
          "www.youtube.com",
          "i.ytimg.com",
        ],
      },
    };
  }

  /** Resolve a tcmedia asset reference for the protocol handler. */
  async resolveMedia(
    assetId: string,
    variantId: string,
  ): Promise<
    | { kind: "file"; path: string; mimeType: string }
    | { kind: "remote"; url: string; headers: Record<string, string> }
    | null
  > {
    const manifest = this.activeManifest ?? this.pendingManifest;
    const asset =
      manifest?.assets.find(
        (a) => a.assetId === assetId && a.variantId === variantId,
      ) ??
      // Widget/layout references may carry the asset id only; fall back to any
      // variant of that asset.
      manifest?.assets.find((a) => a.assetId === assetId);
    if (!asset) {
      return null;
    }
    const cached = await this.manifestSync.cachedPath(asset);
    if (cached) {
      return { kind: "file", path: cached, mimeType: asset.mimeType };
    }
    return {
      kind: "remote",
      url: this.client.url(asset.downloadPath),
      headers: this.client.authHeaders(),
    };
  }

  // -------------------------------------------------------------- self-heal

  private async supervisorTick(): Promise<void> {
    // Only supervise when something should actually be rendering.
    if (this.playbackState !== "playing") {
      return;
    }
    const decision = evaluate(
      this.supervisorState,
      Date.now(),
      DEFAULT_SUPERVISOR_CONFIG,
    );
    if (decision.state !== this.supervisorState) {
      this.supervisorState = decision.state;
      await this.store.writeJson(SUPERVISOR_FILE, this.supervisorState);
    }
    if (decision.action !== "none") {
      log.warn("self-heal action", {
        action: decision.action,
        escalationStep: this.supervisorState.escalationStep,
      });
      // Report the attempt; confirmed recovery is the separate
      // connection.recovered / content progress event.
      void this.activity?.record({
        eventType:
          decision.action === "enter_safe_mode"
            ? "reliability.safe_mode"
            : "reliability.self_heal",
        category: "reliability",
        severity:
          decision.action === "enter_safe_mode" ? "critical" : "warning",
        failureCode: decision.action,
        metadata: { escalationStep: this.supervisorState.escalationStep },
      });
      // Flush reliability events promptly so Studio sees an outage even if the
      // action about to run restarts the process.
      void this.activity?.flush();
      this.applyHealAction(decision.action);
    }
  }

  private applyHealAction(action: HealAction): void {
    switch (action) {
      case "reactivate_content":
        // Local first: re-present cached content without server contact.
        this.evaluatePresentation(true);
        break;
      case "recreate_renderer":
        this.host.recreateRenderer();
        break;
      case "recreate_window":
        this.host.recreateWindow();
        break;
      case "restart_process":
        this.host.restartProcess();
        break;
      case "enter_safe_mode":
        this.evaluatePresentation(true);
        break;
      case "none":
        break;
    }
  }

  // ---------------------------------------------------------------- status

  private statusIntervalSeconds(): number {
    const value = Number(this.config?.sync?.["statusReportSeconds"]);
    return Number.isFinite(value) && value >= 15
      ? value
      : DEFAULT_STATUS_INTERVAL_S;
  }

  private async buildHeartbeat(): Promise<Heartbeat> {
    const size = this.host.screenSize();
    const manifest = this.activeManifest;
    const heartbeat: Heartbeat = {
      screenWidth: size.width,
      screenHeight: size.height,
      playerVersion: this.options.playerVersion,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1_000),
      playbackState: this.playbackState,
      playbackDisabled: this.flags.playbackDisabled,
      safeMode: this.supervisorState.safeMode,
      recoveryLevel: this.supervisorState.escalationStep,
      recoveryCount: this.supervisorState.ladderRunsAtMs.length,
      websiteRendererRecoveryCount: this.websiteRecoveryCount,
    };
    if (manifest) {
      heartbeat.activeManifestVersion = manifest.manifestVersion;
    }
    if (this.pendingManifest) {
      heartbeat.pendingManifestVersion = this.pendingManifest.manifestVersion;
    }
    if (this.currentItemId) {
      heartbeat.currentItemId = this.currentItemId;
    }
    if (this.selection) {
      heartbeat.selectionSource = this.selection.source;
      if (this.selection.scheduleId) {
        heartbeat.currentScheduleId = this.selection.scheduleId;
      }
      if (this.selection.playlistId) {
        heartbeat.currentPlaylistId = this.selection.playlistId;
      }
      if (this.selection.emergencyId) {
        heartbeat.activeEmergencyId = this.selection.emergencyId;
        heartbeat.emergencyState = "active";
      }
    }
    if (this.config) {
      heartbeat.activeConfigRevision = this.config.configRevision;
    }
    if (this.manifestSync.lastSyncError) {
      heartbeat.lastSynchronizationError =
        this.manifestSync.lastSyncError.slice(0, 240);
    }
    if (this.lastPlaybackError) {
      heartbeat.lastPlaybackError = this.lastPlaybackError;
    }
    if (this.lastCommand) {
      heartbeat.lastCommandId = this.lastCommand.id;
      heartbeat.lastCommandState = this.lastCommand.state;
      heartbeat.lastCommandResult = this.lastCommand.result;
      heartbeat.lastCommandCompletedAt = this.lastCommand.completedAt;
    }
    const storage = await this.host.availableStorageBytes();
    if (storage !== null) {
      heartbeat.availableStorageBytes = storage;
    }
    return heartbeat;
  }

  private async reportStatus(): Promise<void> {
    if (!this.credential || !this.identityVerified) {
      return;
    }
    const heartbeat = await this.buildHeartbeat();
    // Socket is the fast path; HTTP heartbeat is the fallback so presence
    // degrades to "recent"/"stale" honestly rather than flapping.
    if (this.socket?.isOpen && this.socket.sendStatus(heartbeat)) {
      return;
    }
    try {
      await this.client.heartbeat(heartbeat);
    } catch (err) {
      if (err instanceof ApiError && err.credentialRejected) {
        await this.onCredentialRejected();
      }
    }
  }

  // --------------------------------------------------------------- commands

  private buildCommandHandlers(): Map<
    string,
    (command: PlayerCommand) => Promise<CommandResultReport>
  > {
    const ok = (code: string, message = ""): CommandResultReport => ({
      success: true,
      code,
      message,
    });
    const handlers = new Map<
      string,
      (command: PlayerCommand) => Promise<CommandResultReport>
    >();

    handlers.set("sync_now", async () => {
      await this.manifestSync.syncNow("command");
      await this.configSync.syncNow("command");
      return ok("synchronized");
    });
    handlers.set("resynchronize_player", async () => {
      await this.manifestSync.syncNow("command");
      await this.configSync.syncNow("command");
      this.evaluatePresentation(true);
      return ok("synchronized");
    });
    handlers.set("reload_playback", async () => {
      this.evaluatePresentation(true);
      return ok("playback_reloaded");
    });
    handlers.set("identify_screen", async (command) => {
      const duration = Number(command.payload?.["durationSeconds"] ?? 15);
      this.host.identify(
        this.credential?.screenName ?? "Tilecast Player",
        Math.min(Math.max(duration, 5), 120),
      );
      return ok("identified");
    });
    handlers.set("clear_media_cache", async () => {
      await this.manifestSync.clearMediaCache();
      return ok("cache_cleared");
    });
    handlers.set("clear_website_data", async () => {
      await this.host.clearWebsiteData();
      return ok("website_data_cleared");
    });
    handlers.set("disable_playback", async () => {
      this.flags.playbackDisabled = true;
      await this.store.writeJson(PLAYBACK_FLAGS_FILE, this.flags);
      this.evaluatePresentation(true);
      return ok("playback_disabled");
    });
    handlers.set("enable_playback", async () => {
      this.flags.playbackDisabled = false;
      await this.store.writeJson(PLAYBACK_FLAGS_FILE, this.flags);
      this.evaluatePresentation(true);
      return ok("playback_enabled");
    });
    handlers.set("retry_current_item", async () => {
      this.host.retryCurrentItem();
      return ok("retried");
    });
    handlers.set("skip_current_item", async () => {
      this.host.skipCurrentItem();
      return ok("skipped");
    });
    handlers.set("recreate_renderer", async () => {
      this.host.recreateRenderer();
      return ok("renderer_recreated");
    });
    handlers.set("recreate_playback_session", async () => {
      this.host.recreateRenderer();
      return ok("playback_session_recreated");
    });
    handlers.set("retry_player_recovery", async () => {
      this.supervisorState = {
        ...this.supervisorState,
        lastActionAtMs: null,
      };
      await this.supervisorTick();
      return ok("recovery_retried");
    });
    handlers.set("exit_safe_mode", async () => {
      this.supervisorState = clearSafeMode(this.supervisorState, Date.now());
      await this.store.writeJson(SUPERVISOR_FILE, this.supervisorState);
      this.evaluatePresentation(true);
      return ok("safe_mode_cleared");
    });
    handlers.set("run_player_self_test", async () => {
      const results: string[] = [];
      results.push(this.activeManifest ? "manifest:ok" : "manifest:none");
      results.push(this.socketOpen ? "socket:open" : "socket:closed");
      try {
        await this.store.writeJson("self-test.json", { at: Date.now() });
        await this.store.delete("self-test.json");
        results.push("storage:ok");
      } catch {
        results.push("storage:failed");
      }
      const failed = results.some((r) => r.endsWith(":failed"));
      return {
        success: !failed,
        code: failed ? "self_test_failed" : "self_test_passed",
        message: results.join(" "),
      };
    });

    return handlers;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
