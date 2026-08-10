/**
 * The Player's durable queue of completed Noise Meter history buckets.
 *
 * The renderer measures and aggregates; this is where an aggregate becomes
 * something that survives a renderer reload, a player restart, a night without
 * a network, and a server that is down. It lives in the trusted core beside the
 * rest of the player state, so the sandboxed renderer never holds the only copy
 * and never touches the disk itself.
 *
 * Two properties matter more than anything else here:
 *
 *   Nothing is dropped because a request was attempted. A batch leaves the
 *   queue only once the server has said, in its heartbeat response, how many
 *   records it has taken responsibility for.
 *
 *   Nothing grows without bound. A player that never reaches its server again
 *   keeps a bounded window and a hard record ceiling, and prunes from the old
 *   end, so an outage costs a few megabytes rather than the disk.
 *
 * What is stored is derived numbers. There is no audio here, and no field that
 * could carry any.
 */

import type { StateStore } from "./storage";
import { logger } from "./log";

const log = logger("noise-history");

const HISTORY_FILE = "noise-history.json";

/** The fixed local aggregation window, matching the renderer and the server. */
export const NOISE_HISTORY_BUCKET_MS = 10_000;

/**
 * Records per heartbeat. Twenty minutes of history at a time: enough to drain a
 * long outage over a handful of ordinary heartbeats, small enough that one
 * request stays an ordinary request.
 */
export const NOISE_HISTORY_BATCH = 120;

/**
 * Hard ceiling on the local queue, independent of the configured retention. At
 * ten seconds a bucket this is a week of continuous monitoring; past it the
 * oldest records are dropped so a permanently offline player cannot fill a
 * disk with a room's history.
 */
const MAX_RECORDS = 60_480;

const DEFAULT_RETENTION_DAYS = 7;

export interface NoiseHistoryBucket {
  startedAt: string;
  averageLevel: number;
  peakLevel: number;
  monitoredMs: number;
  warningMs: number;
  loudMs: number;
  triggerCount: number;
}

interface StoredHistory {
  records: NoiseHistoryBucket[];
}

function finiteLevel(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
}

function finiteDuration(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(NOISE_HISTORY_BUCKET_MS, Math.max(0, Math.round(value)));
}

/**
 * Reject what cannot be trusted rather than storing it.
 *
 * A NaN average, a negative duration, or a timestamp from next year is a bug or
 * a corrupted file either way, and history that has to be believed later is not
 * the place to be permissive. The server sanitizes again on arrival; this keeps
 * the local file from carrying garbage in the first place.
 */
export function sanitizeNoiseHistoryBucket(
  value: unknown,
  nowMs: number,
  retentionMs: number,
): NoiseHistoryBucket | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const startedAt = Date.parse(String(record["startedAt"] ?? ""));
  if (!Number.isFinite(startedAt)) return null;
  // No history from the future, and nothing already past its retention window.
  if (startedAt > nowMs + 120_000 || startedAt < nowMs - retentionMs) {
    return null;
  }
  const averageLevel = finiteLevel(record["averageLevel"]);
  const peakLevel = finiteLevel(record["peakLevel"]);
  const monitoredMs = finiteDuration(record["monitoredMs"]);
  const warningMs = finiteDuration(record["warningMs"]);
  const loudMs = finiteDuration(record["loudMs"]);
  if (
    averageLevel === null ||
    peakLevel === null ||
    monitoredMs === null ||
    warningMs === null ||
    loudMs === null
  ) {
    return null;
  }
  if (monitoredMs <= 0 || warningMs + loudMs > monitoredMs) return null;
  const triggerCount = record["triggerCount"];
  const triggers =
    typeof triggerCount === "number" &&
    Number.isFinite(triggerCount) &&
    triggerCount >= 0
      ? Math.min(1_000, Math.round(triggerCount))
      : 0;
  return {
    // Aligned to the fixed grid, so a retry cannot produce a second row for the
    // same ten seconds under a slightly different key.
    startedAt: new Date(
      Math.floor(startedAt / NOISE_HISTORY_BUCKET_MS) * NOISE_HISTORY_BUCKET_MS,
    ).toISOString(),
    averageLevel,
    peakLevel: Math.max(peakLevel, averageLevel),
    monitoredMs,
    warningMs,
    loudMs,
    triggerCount: triggers,
  };
}

export class NoiseHistoryQueue {
  private records: NoiseHistoryBucket[] = [];
  private loaded = false;
  private retentionDays = DEFAULT_RETENTION_DAYS;
  private writesPending = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: StateStore,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Retention comes from the manifest, so both ends prune the same window. */
  setRetentionDays(days: number): void {
    if (Number.isFinite(days) && days >= 1 && days <= 30) {
      this.retentionDays = Math.round(days);
    }
  }

  private retentionMs(): number {
    return this.retentionDays * 24 * 60 * 60 * 1_000;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await this.store.readJson<StoredHistory>(HISTORY_FILE);
    const nowMs = this.now();
    const retention = this.retentionMs();
    this.records = (stored?.records ?? [])
      .map((record) => sanitizeNoiseHistoryBucket(record, nowMs, retention))
      .filter((record): record is NoiseHistoryBucket => record !== null);
    this.prune();
    if ((stored?.records?.length ?? 0) !== this.records.length) {
      log.warn("dropped unusable noise history records on load", {
        kept: this.records.length,
        found: stored?.records?.length ?? 0,
      });
    }
  }

  size(): number {
    return this.records.length;
  }

  /**
   * Accept one completed bucket. A repeat of a slot already queued replaces it
   * rather than queueing a second copy, which keeps a renderer reload mid-bucket
   * from producing two records for the same ten seconds.
   */
  async add(bucket: NoiseHistoryBucket): Promise<boolean> {
    await this.load();
    const clean = sanitizeNoiseHistoryBucket(
      bucket,
      this.now(),
      this.retentionMs(),
    );
    if (!clean) {
      log.warn("rejected an unusable noise history bucket");
      return false;
    }
    const existing = this.records.findIndex(
      (record) => record.startedAt === clean.startedAt,
    );
    if (existing >= 0) {
      this.records[existing] = clean;
    } else {
      this.records.push(clean);
      this.records.sort((left, right) =>
        left.startedAt.localeCompare(right.startedAt),
      );
    }
    this.prune();
    await this.persist();
    return true;
  }

  /**
   * The oldest bounded batch. Peeking never removes anything: the records stay
   * until a heartbeat comes back saying they arrived.
   */
  peekBatch(limit = NOISE_HISTORY_BATCH): NoiseHistoryBucket[] {
    const size = Math.min(Math.max(1, limit), NOISE_HISTORY_BATCH);
    return this.records.slice(0, size);
  }

  /**
   * Drop the records the server acknowledged, oldest first, and only those. A
   * partial acknowledgement leaves the rest queued for the next heartbeat.
   */
  async acknowledge(
    records: NoiseHistoryBucket[],
    accepted: number,
  ): Promise<void> {
    if (records.length === 0 || accepted <= 0) return;
    const consumed = Math.min(records.length, Math.floor(accepted));
    const sent = new Set(
      records.slice(0, consumed).map((record) => record.startedAt),
    );
    this.records = this.records.filter((record) => !sent.has(record.startedAt));
    await this.persist(true);
  }

  /** Drop everything past retention or over the hard ceiling, oldest first. */
  private prune(): void {
    const oldest = this.now() - this.retentionMs();
    this.records = this.records.filter(
      (record) => Date.parse(record.startedAt) >= oldest,
    );
    if (this.records.length > MAX_RECORDS) {
      const dropped = this.records.length - MAX_RECORDS;
      this.records = this.records.slice(dropped);
      log.warn("noise history queue is full; dropped the oldest records", {
        dropped,
        kept: this.records.length,
      });
    }
  }

  /**
   * Write the queue out.
   *
   * A small queue — the steady state, where each heartbeat drains it — is
   * written on every bucket. A large one, which only happens during an outage,
   * is written every sixth bucket instead, so an offline night does not rewrite
   * a megabyte of JSON every ten seconds. At most a minute of buckets can be
   * lost to an abrupt power cut, which is the same exposure as the readings
   * still inside the aggregator.
   */
  private async persist(force = false): Promise<void> {
    this.writesPending += 1;
    if (!force && this.records.length > 600 && this.writesPending < 6) {
      return;
    }
    this.writesPending = 0;
    const snapshot: StoredHistory = { records: this.records.slice() };
    this.writing = this.writing
      .catch(() => {})
      .then(() => this.store.writeJson(HISTORY_FILE, snapshot))
      .catch((error: unknown) => {
        log.warn("failed to persist noise history", { error: String(error) });
      });
    await this.writing;
  }

  /** Called on shutdown so an orderly stop never loses a queued bucket. */
  async flush(): Promise<void> {
    if (!this.loaded) return;
    await this.persist(true);
  }
}
