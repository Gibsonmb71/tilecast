/**
 * Manifest synchronization.
 *
 * The manifest is fetched conditionally (ETag / 304) on connect, whenever the
 * socket announces `manifest.changed`, and on a five-minute reconciliation
 * timer that runs regardless of socket state — so content updates flow even
 * if every push notification is lost.
 *
 * A new manifest is prepared off to the side: every required media variant is
 * downloaded (resumable), size- and SHA-256-verified, and only then is the
 * manifest persisted as *pending* and offered to playback, which swaps at the
 * next item boundary. Failed preparation never disturbs the active manifest
 * or its cached files. At boot the persisted active manifest plays
 * immediately with no network.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { ApiError, NetworkError, type ApiClient } from "./api";
import { downloadVerified, DownloadError } from "./download";
import { logger } from "./log";
import type { StateStore } from "./storage";
import type { Manifest, ManifestAsset } from "./types";

const log = logger("manifest");

const ACTIVE_FILE = "manifest-active.json";
export const RECONCILE_INTERVAL_MS = 5 * 60_000;
const MAX_CONCURRENT_DOWNLOADS = 2;
/** "automatic" policy downloads video up to this size, else streams. */
const AUTOMATIC_VIDEO_LIMIT_BYTES = 256 * 1024 * 1024;

export interface StoredManifest {
  manifest: Manifest;
  etag: string | null;
  storedAt: string;
}

export interface ManifestSyncEvents {
  /** A fully verified manifest is ready; playback swaps at item boundary. */
  onManifestPrepared(manifest: Manifest): void;
  onCredentialRejected(): void;
  onSyncError(error: string): void;
}

export function mediaFileName(asset: ManifestAsset): string {
  return `${asset.assetId}-${asset.variantId}`;
}

/** Variants that must be fully cached before the manifest may activate. */
export function requiredDownloads(manifest: Manifest): ManifestAsset[] {
  const byAsset = new Map<string, ManifestAsset>();
  for (const asset of manifest.assets) {
    byAsset.set(`${asset.assetId}:${asset.variantId}`, asset);
  }

  const wanted = new Map<string, ManifestAsset>();
  const addAsset = (assetId: string, variantId: string | null | undefined) => {
    if (!variantId) {
      // Without a variant reference, fall back to any variant rows for the
      // asset (e.g. website fallback images referenced by asset only).
      for (const asset of manifest.assets) {
        if (asset.assetId === assetId) {
          wanted.set(`${asset.assetId}:${asset.variantId}`, asset);
        }
      }
      return;
    }
    const asset = byAsset.get(`${assetId}:${variantId}`);
    if (asset) {
      wanted.set(`${asset.assetId}:${asset.variantId}`, asset);
    }
  };

  const playlists = [
    manifest.playlist,
    manifest.directFallbackPlaylist,
    ...(manifest.playlists ?? []),
  ];
  for (const playlist of playlists) {
    if (!playlist) {
      continue;
    }
    for (const item of playlist.items) {
      if (item.assetType === "website" || item.layoutId) {
        continue; // no media variant; websites stream, layouts are skipped
      }
      const asset = item.variantId
        ? byAsset.get(`${item.assetId}:${item.variantId}`)
        : undefined;
      if (!asset) {
        continue;
      }
      const isVideo = asset.mimeType.startsWith("video/");
      const policy = item.deliveryPolicy;
      const download =
        policy === "download" ||
        (policy === "automatic" &&
          (!isVideo || asset.fileSize <= AUTOMATIC_VIDEO_LIMIT_BYTES));
      if (download) {
        wanted.set(`${asset.assetId}:${asset.variantId}`, asset);
      }
    }
  }

  // Website fallback images must be verified before activation.
  for (const website of manifest.websites ?? []) {
    if (website.fallbackImageAssetId) {
      addAsset(website.fallbackImageAssetId, website.fallbackVariantId);
    }
  }

  // Layout-referenced images (asset placements and canvas backgrounds) must
  // be cached so a Layout renders correctly offline. Videos inside layout
  // zones follow their own playlist item's delivery policy, handled above.
  const layouts = [
    ...(manifest.layouts ?? []),
    ...(manifest.layout ? [manifest.layout] : []),
  ] as Array<{
    document?: {
      canvas?: { backgroundAssetId?: string | null };
      placements?: Array<{ type: string; assetId?: string | null }>;
    };
  }>;
  for (const layout of layouts) {
    const document = layout?.document;
    if (!document) {
      continue;
    }
    if (document.canvas?.backgroundAssetId) {
      addAsset(document.canvas.backgroundAssetId, null);
    }
    for (const placement of document.placements ?? []) {
      if (placement.type === "asset" && placement.assetId) {
        // Only images are required upfront; a zone video may stream.
        const variant = manifest.assets.find(
          (a) =>
            a.assetId === placement.assetId && a.mimeType.startsWith("image/"),
        );
        if (variant) {
          addAsset(placement.assetId, variant.variantId);
        }
      }
    }
  }

  return [...wanted.values()];
}

export class ManifestSync {
  private syncing = false;
  private syncQueued = false;
  private stored: StoredManifest | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  lastSyncError: string | null = null;

  constructor(
    private readonly store: StateStore,
    private readonly client: ApiClient,
    private readonly events: ManifestSyncEvents,
  ) {}

  /**
   * Activate the persisted manifest from disk with zero network. Safe to
   * call before any credential is sent; boot playback never waits.
   */
  async loadCached(): Promise<void> {
    this.stored = await this.store.readJson<StoredManifest>(ACTIVE_FILE);
    if (this.stored) {
      log.info("activating cached manifest at boot", {
        manifestVersion: this.stored.manifest.manifestVersion,
      });
      this.events.onManifestPrepared(this.stored.manifest);
    }
  }

  /** Begin network reconciliation. Call only after the identity gate. */
  async start(): Promise<void> {
    this.timer = setInterval(() => {
      void this.syncNow("reconcile-timer");
    }, RECONCILE_INTERVAL_MS);
    this.timer.unref?.();
    await this.syncNow("startup");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get activeManifest(): Manifest | null {
    return this.stored?.manifest ?? null;
  }

  /** Serialized; a request during a sync queues one follow-up pass. */
  async syncNow(trigger: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.syncing) {
      this.syncQueued = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncQueued = false;
        await this.runOnce(trigger);
      } while (this.syncQueued && !this.stopped);
    } finally {
      this.syncing = false;
    }
  }

  private async runOnce(trigger: string): Promise<void> {
    let result;
    try {
      result = await this.client.manifest(this.stored?.etag ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.credentialRejected) {
        this.events.onCredentialRejected();
        return;
      }
      this.lastSyncError = String(err);
      if (!(err instanceof NetworkError)) {
        this.events.onSyncError(this.lastSyncError);
      }
      return;
    }

    if (result.notModified || !result.value) {
      this.lastSyncError = null;
      return;
    }

    const manifest = result.value;
    log.info("manifest changed; preparing", {
      trigger,
      manifestVersion: manifest.manifestVersion,
      schemaVersion: manifest.schemaVersion,
    });

    try {
      await this.prepare(manifest);
    } catch (err) {
      this.lastSyncError = `preparation failed: ${String(err)}`;
      this.events.onSyncError(this.lastSyncError);
      // Active manifest stays untouched; the reconcile timer retries.
      return;
    }

    this.stored = {
      manifest,
      etag: result.etag,
      storedAt: new Date().toISOString(),
    };
    await this.store.writeJson(ACTIVE_FILE, this.stored);
    this.lastSyncError = null;
    this.events.onManifestPrepared(manifest);
    await this.cleanupCache();
  }

  /** Download and verify everything the manifest requires. */
  private async prepare(manifest: Manifest): Promise<void> {
    const required = requiredDownloads(manifest);
    const mediaDir = this.store.mediaDir();
    const queue = [...required];
    const failures: string[] = [];

    const worker = async () => {
      for (;;) {
        const asset = queue.shift();
        if (!asset) {
          return;
        }
        const destination = path.join(mediaDir, mediaFileName(asset));
        try {
          await downloadVerified(
            {
              url: this.client.url(asset.downloadPath),
              headers: this.client.authHeaders(),
              destination,
              expectedSha256: asset.sha256,
              expectedSizeBytes: asset.fileSize,
              etag: `"${asset.sha256}"`,
            },
            undefined,
          );
        } catch (err) {
          if (err instanceof DownloadError && !err.retryable) {
            failures.push(`${asset.assetId}: ${err.message}`);
          } else {
            failures.push(`${asset.assetId}: ${String(err)}`);
          }
        }
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_DOWNLOADS, required.length) },
        worker,
      ),
    );

    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
  }

  /** Local media path for a cached variant, or null if not cached. */
  async cachedPath(asset: ManifestAsset): Promise<string | null> {
    const filePath = path.join(this.store.mediaDir(), mediaFileName(asset));
    try {
      const stat = await fs.stat(filePath);
      return stat.size === asset.fileSize ? filePath : null;
    } catch {
      return null;
    }
  }

  /** Remove cached media no longer referenced by the active manifest. */
  private async cleanupCache(): Promise<void> {
    const manifest = this.stored?.manifest;
    if (!manifest) {
      return;
    }
    const keep = new Set(manifest.assets.map((a) => mediaFileName(a)));
    let entries: string[];
    try {
      entries = await fs.readdir(this.store.mediaDir());
    } catch {
      return;
    }
    for (const entry of entries) {
      const base = entry.endsWith(".part") ? entry.slice(0, -5) : entry;
      if (!keep.has(base)) {
        await fs
          .rm(path.join(this.store.mediaDir(), entry), { force: true })
          .catch(() => {});
      }
    }
  }

  async clearMediaCache(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.store.mediaDir());
    } catch {
      return;
    }
    for (const entry of entries) {
      await fs
        .rm(path.join(this.store.mediaDir(), entry), { force: true })
        .catch(() => {});
    }
    // Force a full re-download and re-verification on the next sync.
    this.stored = null;
    await this.store.delete(ACTIVE_FILE);
    await this.syncNow("clear_media_cache");
  }
}
