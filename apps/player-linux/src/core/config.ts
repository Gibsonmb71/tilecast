/**
 * Player configuration synchronization.
 *
 * Config is fetched with ETag on connect, on `config.changed`, and alongside
 * the manifest reconcile timer. The current and previous valid configurations
 * are persisted so a bad sync can never leave the player configless, and the
 * cached config applies immediately at boot with no network.
 */

import { ApiError, NetworkError, type ApiClient } from "./api";
import { logger } from "./log";
import type { StateStore } from "./storage";
import type { PlayerConfig } from "./types";
import { cacheIdentityMatches, type CacheIdentity } from "./cache-identity";

const log = logger("config");

const CONFIG_FILE = "player-config.json";

interface StoredConfig {
  etag: string | null;
  current: PlayerConfig;
  previous: PlayerConfig | null;
  installationId?: string;
  screenId?: string;
  normalizedServerUrl?: string;
}

export interface ConfigSyncEvents {
  onConfigApplied(config: PlayerConfig): void;
  onCredentialRejected(): void;
}

export class ConfigSync {
  private stored: StoredConfig | null = null;
  private operation: Promise<void> = Promise.resolve();
  private queuedTrigger: string | null = null;
  private syncing = false;
  private identity: CacheIdentity | null = null;
  lastConfigError: string | null = null;

  constructor(
    private readonly store: StateStore,
    private readonly client: ApiClient,
    private readonly events: ConfigSyncEvents,
  ) {}

  setIdentity(identity: CacheIdentity | null): void {
    this.identity = identity;
  }

  async invalidateCachedState(): Promise<void> {
    this.stored = null;
    await this.store.delete(CONFIG_FILE);
  }

  /** Apply the persisted configuration from disk with zero network. */
  async loadCached(): Promise<void> {
    this.stored = await this.store.readJson<StoredConfig>(CONFIG_FILE);
    if (
      this.stored &&
      (!this.identity || !cacheIdentityMatches(this.identity, this.stored))
    ) {
      await this.invalidateCachedState();
      return;
    }
    if (this.stored) {
      this.events.onConfigApplied(this.stored.current);
    }
  }

  get current(): PlayerConfig | null {
    return this.stored?.current ?? null;
  }

  async syncNow(trigger: string): Promise<void> {
    if (this.syncing) {
      this.queuedTrigger = trigger;
      return this.operation;
    }
    this.syncing = true;
    this.operation = (async () => {
      let next: string | null = trigger;
      while (next) {
        this.queuedTrigger = null;
        await this.syncExclusive(next);
        next = this.queuedTrigger;
      }
    })().finally(() => {
      this.syncing = false;
      this.queuedTrigger = null;
    });
    return this.operation;
  }

  private async syncExclusive(trigger: string): Promise<void> {
    let result;
    try {
      result = await this.client.config(this.stored?.etag ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.credentialRejected) {
        this.events.onCredentialRejected();
        return;
      }
      this.lastConfigError = err instanceof NetworkError ? null : String(err);
      return;
    }
    if (result.notModified || !result.value) {
      this.lastConfigError = null;
      return;
    }
    const config = result.value;
    if (
      typeof config.configRevision !== "number" ||
      typeof config.schemaVersion !== "number"
    ) {
      this.lastConfigError = "invalid configuration payload";
      return;
    }
    if (
      this.stored &&
      config.configRevision < this.stored.current.configRevision
    ) {
      // Revisions are monotonic; never regress on a stale read.
      return;
    }
    this.stored = {
      etag: result.etag,
      current: config,
      previous: this.stored?.current ?? null,
      installationId: this.identity?.installationId,
      screenId: this.identity?.screenId,
      normalizedServerUrl: this.identity?.normalizedServerUrl,
    };
    await this.store.writeJson(CONFIG_FILE, this.stored);
    this.lastConfigError = null;
    log.info("configuration applied", {
      trigger,
      configRevision: config.configRevision,
    });
    this.events.onConfigApplied(config);
  }
}
