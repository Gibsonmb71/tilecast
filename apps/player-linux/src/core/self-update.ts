/**
 * Server-driven self-update for the Linux (AppImage) player.
 *
 * The Android player installs a signed APK; the Linux player instead replaces
 * its own AppImage. On an `install_player_update` command the updater fetches
 * the release metadata, downloads and verifies the AppImage (SHA-256 + size,
 * reusing the resumable `downloadVerified` helper), atomically renames it over
 * the running AppImage (`process.env.APPIMAGE`), then relaunches so the systemd
 * unit restarts into the new version. Progress is reported to the server's
 * update-deployment status endpoint; the terminal `succeeded` transition is
 * derived server-side from the next heartbeat's higher version code.
 *
 * The command is dispatched as a "disruptive" command, so the coordinator has
 * already persisted the idempotency key and reported the command result before
 * this runs — a relaunch therefore neither re-runs nor dangles the command, and
 * a failed update is surfaced purely through the status endpoint (a retry gets a
 * fresh command).
 */

import type { DownloadRequest } from "./download";
import { logger } from "./log";
import type {
  PlayerCommand,
  UpdateMetadata,
  UpdateStatusReport,
} from "./types";

const log = logger("self-update");

/** Longest we will hold a maintenance-window install pending before giving up. */
const MAX_WINDOW_DELAY_MS = 24 * 60 * 60 * 1_000;

export interface SelfUpdateDeps {
  /** The running AppImage path (process.env.APPIMAGE), or null when not packaged. */
  appImagePath: string | null;
  /** Absolute path the AppImage is staged to before it is promoted. */
  stagePath: string;
  fetchMetadata(releaseId: string): Promise<UpdateMetadata>;
  reportStatus(deploymentId: string, body: UpdateStatusReport): Promise<void>;
  download(request: DownloadRequest): Promise<void>;
  /** Build an absolute server URL from a server-relative path. */
  buildUrl(path: string): string;
  /** Device credential headers for the artifact download. */
  authHeaders(): Record<string, string>;
  /** Atomically promote the staged AppImage over the running one. */
  promote(from: string, to: string): Promise<void>;
  /** End the process so systemd relaunches into the new AppImage. */
  restart(): void;
  now(): number;
}

/**
 * Derive a monotonic numeric version code from a semantic version string, the
 * same formula the Linux release build bakes into the signed manifest. Extra
 * pre-release/build metadata is ignored. Returns 0 for an unparseable version.
 */
export function parseVersionCode(version: string): number {
  const core = version.trim().split(/[-+]/, 1)[0] ?? "";
  const parts = core.split(".");
  const major = Number.parseInt(parts[0] ?? "", 10);
  const minor = Number.parseInt(parts[1] ?? "", 10);
  const patch = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(major)) {
    return 0;
  }
  return (
    major * 1_000_000 +
    (Number.isFinite(minor) ? minor : 0) * 1_000 +
    (Number.isFinite(patch) ? patch : 0)
  );
}

interface UpdatePayload {
  deploymentId: string;
  releaseId: string;
  installationMode: string;
  expectedArtifactSha256?: string;
  maintenanceWindowStart?: string;
}

function readPayload(command: PlayerCommand): UpdatePayload | null {
  const payload = command.payload ?? {};
  const deploymentId = String(payload["deploymentId"] ?? "");
  const releaseId = String(payload["releaseId"] ?? "");
  const installationMode = String(payload["installationMode"] ?? "");
  if (!deploymentId || !releaseId || !installationMode) {
    return null;
  }
  const sha =
    (payload["expectedArtifactSha256"] as string | undefined) ??
    (payload["expectedApkSha256"] as string | undefined);
  return {
    deploymentId,
    releaseId,
    installationMode,
    expectedArtifactSha256: typeof sha === "string" ? sha : undefined,
    maintenanceWindowStart:
      typeof payload["maintenanceWindowStart"] === "string"
        ? (payload["maintenanceWindowStart"] as string)
        : undefined,
  };
}

export class SelfUpdater {
  constructor(private readonly deps: SelfUpdateDeps) {}

  /** Execute an install_player_update command. Never throws. */
  async run(command: PlayerCommand): Promise<void> {
    const payload = readPayload(command);
    if (!payload) {
      log.warn("ignoring malformed install_player_update payload", {
        id: command.id,
      });
      return;
    }
    const { deploymentId } = payload;
    try {
      if (!this.deps.appImagePath) {
        // Not packaged as an AppImage (dev run or unmanaged install): the
        // systemd/AppImage self-update channel does not apply here.
        await this.report(deploymentId, {
          state: "failed",
          error: "player is not running as a managed AppImage",
        });
        return;
      }

      await this.report(deploymentId, { state: "downloading" });
      const meta = await this.deps.fetchMetadata(payload.releaseId);
      if (
        meta.platform !== "linux" ||
        !meta.artifactPath ||
        !meta.artifactSha256 ||
        !meta.artifactSizeBytes
      ) {
        throw new Error("release metadata is not a Linux AppImage");
      }
      if (
        payload.expectedArtifactSha256 &&
        meta.artifactSha256.toLowerCase() !==
          payload.expectedArtifactSha256.toLowerCase()
      ) {
        throw new Error("artifact hash does not match the deployment");
      }

      await this.deps.download({
        url: this.deps.buildUrl(meta.artifactPath),
        headers: this.deps.authHeaders(),
        destination: this.deps.stagePath,
        expectedSha256: meta.artifactSha256,
        expectedSizeBytes: meta.artifactSizeBytes,
      });
      await this.report(deploymentId, {
        state: "downloaded",
        downloadedBytes: meta.artifactSizeBytes,
      });
      // The download already verified size + SHA-256; surface the state anyway
      // so the dashboard mirrors the Android progression.
      await this.report(deploymentId, { state: "verifying" });
      await this.report(deploymentId, { state: "ready" });

      const delay = this.installDelayMs(payload);
      if (delay === null) {
        // download_only: staged and verified; a later install completes it.
        log.info("update staged; awaiting a separate install trigger", {
          deploymentId,
        });
        return;
      }
      if (delay > 0) {
        log.info("update staged; installing at maintenance window", {
          deploymentId,
          delayMs: delay,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      await this.report(deploymentId, { state: "installing" });
      await this.deps.promote(this.deps.stagePath, this.deps.appImagePath);
      // Signal that a relaunch is imminent; the next heartbeat's higher version
      // code is what the server settles to "succeeded".
      await this.report(deploymentId, { state: "reconnecting" });
      log.info("update installed; relaunching", { deploymentId });
      this.deps.restart();
    } catch (err) {
      log.warn("self-update failed", { deploymentId, error: String(err) });
      await this.report(deploymentId, {
        state: "failed",
        error: String(err).slice(0, 240),
      });
    }
  }

  /**
   * Milliseconds to wait before installing, or null when the mode does not
   * install now (download_only). install_now installs immediately (0);
   * maintenance_window installs when the window arrives (clamped).
   */
  private installDelayMs(payload: UpdatePayload): number | null {
    if (payload.installationMode === "install_now") {
      return 0;
    }
    if (payload.installationMode === "maintenance_window") {
      const start = payload.maintenanceWindowStart
        ? Date.parse(payload.maintenanceWindowStart)
        : NaN;
      if (!Number.isFinite(start)) {
        return 0;
      }
      const delta = start - this.deps.now();
      if (delta <= 0) {
        return 0;
      }
      return Math.min(delta, MAX_WINDOW_DELAY_MS);
    }
    // download_only (and any unknown mode): stage only, do not restart.
    return null;
  }

  private async report(
    deploymentId: string,
    body: UpdateStatusReport,
  ): Promise<void> {
    try {
      await this.deps.reportStatus(deploymentId, body);
    } catch (err) {
      // Status is best-effort telemetry; the server reconciles from heartbeats.
      log.debug("update status report failed", {
        deploymentId,
        state: body.state,
        error: String(err),
      });
    }
  }
}
