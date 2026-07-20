import { describe, expect, it, vi } from "vitest";
import {
  SelfUpdater,
  parseVersionCode,
  type SelfUpdateDeps,
} from "./self-update";
import type { PlayerCommand, UpdateMetadata } from "./types";

const RELEASE_ID = "11111111-1111-1111-1111-111111111111";
const DEPLOYMENT_ID = "22222222-2222-2222-2222-222222222222";
const ARTIFACT_SHA =
  "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1230000";

function metadata(overrides: Partial<UpdateMetadata> = {}): UpdateMetadata {
  return {
    releaseId: RELEASE_ID,
    platform: "linux",
    versionCode: 2000,
    versionName: "0.2.0",
    artifactSizeBytes: 4096,
    artifactSha256: ARTIFACT_SHA,
    artifactPath: `/api/v1/player/updates/${RELEASE_ID}/artifact`,
    ...overrides,
  };
}

function command(payload: Record<string, unknown> = {}): PlayerCommand {
  return {
    id: "cmd-1",
    type: "install_player_update",
    idempotencyKey: "cmd-1",
    state: "delivered",
    createdAt: "2026-07-20T00:00:00Z",
    expiresAt: "2026-07-27T00:00:00Z",
    payload: {
      deploymentId: DEPLOYMENT_ID,
      releaseId: RELEASE_ID,
      expectedVersionCode: 2000,
      expectedArtifactSha256: ARTIFACT_SHA,
      installationMode: "install_now",
      ...payload,
    },
  };
}

function deps(overrides: Partial<SelfUpdateDeps> = {}): {
  d: SelfUpdateDeps;
  states: string[];
  restart: ReturnType<typeof vi.fn>;
  promote: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
} {
  const states: string[] = [];
  const restart = vi.fn();
  const promote = vi.fn(async () => {});
  const download = vi.fn(async () => {});
  const d: SelfUpdateDeps = {
    appImagePath: "/home/tilecast/tilecast-player.AppImage",
    stagePath: "/var/lib/tilecast/player-update.AppImage",
    fetchMetadata: async () => metadata(),
    reportStatus: async (_id, body) => {
      states.push(body.state);
    },
    download,
    buildUrl: (path) => `https://server${path}`,
    authHeaders: () => ({ Authorization: "Bearer device" }),
    promote,
    restart,
    now: () => Date.parse("2026-07-20T12:00:00Z"),
    ...overrides,
  };
  return { d, states, restart, promote, download };
}

describe("parseVersionCode", () => {
  it("derives a monotonic code from semver", () => {
    expect(parseVersionCode("0.1.0")).toBe(1000);
    expect(parseVersionCode("0.2.0")).toBe(2000);
    expect(parseVersionCode("1.4.9")).toBe(1_004_009);
    expect(parseVersionCode("2.0.0-beta.1")).toBe(2_000_000);
  });
  it("returns 0 for unparseable versions", () => {
    expect(parseVersionCode("")).toBe(0);
    expect(parseVersionCode("dev")).toBe(0);
  });
});

describe("SelfUpdater", () => {
  it("downloads, verifies, promotes, and relaunches on install_now", async () => {
    const { d, states, restart, promote, download } = deps();
    await new SelfUpdater(d).run(command());

    expect(states).toEqual([
      "downloading",
      "downloaded",
      "verifying",
      "ready",
      "installing",
      "reconnecting",
    ]);
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `https://server/api/v1/player/updates/${RELEASE_ID}/artifact`,
        destination: d.stagePath,
        expectedSha256: ARTIFACT_SHA,
        expectedSizeBytes: 4096,
      }),
    );
    expect(promote).toHaveBeenCalledWith(d.stagePath, d.appImagePath);
    expect(restart).toHaveBeenCalledOnce();
  });

  it("stages but does not restart on download_only", async () => {
    const { d, states, restart, promote } = deps();
    await new SelfUpdater(d).run(
      command({ installationMode: "download_only" }),
    );

    expect(states).toEqual(["downloading", "downloaded", "verifying", "ready"]);
    expect(promote).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("reports failure and does not restart when not an AppImage", async () => {
    const { d, states, restart, download } = deps({ appImagePath: null });
    await new SelfUpdater(d).run(command());

    expect(states).toEqual(["failed"]);
    expect(download).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("fails without restarting when the download hash mismatches the deployment", async () => {
    const { d, states, restart, promote } = deps({
      fetchMetadata: async () => metadata({ artifactSha256: "f".repeat(64) }),
    });
    await new SelfUpdater(d).run(command());

    expect(states).toEqual(["downloading", "failed"]);
    expect(promote).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("propagates a download failure as a failed status", async () => {
    const { d, states, restart, promote } = deps({
      download: vi.fn(async () => {
        throw new Error("sha-256 mismatch");
      }),
    });
    await new SelfUpdater(d).run(command());

    expect(states).toEqual(["downloading", "failed"]);
    expect(promote).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("installs immediately when a maintenance window has already elapsed", async () => {
    const { d, restart, promote } = deps();
    await new SelfUpdater(d).run(
      command({
        installationMode: "maintenance_window",
        maintenanceWindowStart: "2026-07-20T06:00:00Z",
      }),
    );
    expect(promote).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
  });
});
