/**
 * Bounded telemetry reporting.
 *
 * The player measures continuously but reports on a fixed cadence, sending the
 * latest value of each gauge and the accumulated delta of each counter since
 * the previous sample. Raw high-frequency samples are never uploaded and never
 * stored: the server keeps one snapshot row per screen and five-minute
 * rollups, and both are bounded.
 *
 * Threshold events are the server's job. The player reports measurements; the
 * server owns the hysteresis and cooldowns, so a player that restarts cannot
 * re-announce every condition it was already in.
 */

import type { ApiClient } from "./api";
import { logger } from "./log";

const log = logger("telemetry");

/** Matches the server's rollup bucket. */
export const TELEMETRY_INTERVAL_MS = 60_000;

export interface TelemetryGauges {
  currentItemId?: string;
  itemStartedAt?: string;
  lastMeaningfulProgressAt?: string;
  playbackStallDurationMs?: number;
  stallReason?: string;
  rendererState?: string;
  rendererResponding?: boolean;
  expectedMotion?: boolean;
  serverRoundTripMs?: number;
  downloadQueueCount?: number;
  bytesRemaining?: number;
  cacheUsedBytes?: number;
  cacheLimitBytes?: number;
  freeStorageBytes?: number;
  processUptimeSeconds?: number;
  deviceUptimeSeconds?: number;
  syncGroupDriftMs?: number;
  frameFingerprint?: string;
  averageLuminance?: number;
  thermalState?: string;
  memoryPressureState?: string;
}

/** Counters accumulated between samples, then reset. */
interface Counters {
  connectedSeconds: number;
  disconnectedSeconds: number;
  healthyPlaybackSeconds: number;
  stalledPlaybackSeconds: number;
  blackOutputSeconds: number;
  droppedFrames: number;
  frameChangeCount: number;
  downloadedBytes: number;
  cacheHits: number;
  cacheMisses: number;
  consecutiveDownloadFailures: number;
  thermalSeconds: Record<string, number>;
  syncDriftSamples: number[];
  memorySamples: number[];
  cpuSamples: number[];
}

function emptyCounters(): Counters {
  return {
    connectedSeconds: 0,
    disconnectedSeconds: 0,
    healthyPlaybackSeconds: 0,
    stalledPlaybackSeconds: 0,
    blackOutputSeconds: 0,
    droppedFrames: 0,
    frameChangeCount: 0,
    downloadedBytes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    consecutiveDownloadFailures: 0,
    thermalSeconds: {},
    syncDriftSamples: [],
    memorySamples: [],
    cpuSamples: [],
  };
}

/** Percentile from an unsorted sample set; the caller may pass an empty one. */
export function percentile(
  values: number[],
  fraction: number,
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export class TelemetryReporter {
  private counters = emptyCounters();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastFlushMs: number;
  /** Bounded so a long outage cannot grow the in-memory sample sets. */
  private static readonly MAX_SAMPLES = 600;

  constructor(
    private readonly client: ApiClient,
    private readonly gauges: () => TelemetryGauges,
    private readonly now: () => number,
  ) {
    this.lastFlushMs = now();
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.flush(), TELEMETRY_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Adds elapsed seconds to a counter. Called by the player's own tick. */
  addSeconds(counter: keyof Counters, seconds: number): void {
    if (seconds <= 0) return;
    const current = this.counters[counter];
    if (typeof current === "number") {
      (this.counters[counter] as number) = current + seconds;
    }
  }

  addCount(counter: keyof Counters, amount: number): void {
    this.addSeconds(counter, amount);
  }

  recordThermalSeconds(state: string, seconds: number): void {
    if (!state || seconds <= 0) return;
    this.counters.thermalSeconds[state] =
      (this.counters.thermalSeconds[state] ?? 0) + seconds;
  }

  recordSample(kind: "syncDrift" | "memory" | "cpu", value: number): void {
    const target =
      kind === "syncDrift"
        ? this.counters.syncDriftSamples
        : kind === "memory"
          ? this.counters.memorySamples
          : this.counters.cpuSamples;
    if (target.length >= TelemetryReporter.MAX_SAMPLES) {
      // Drop the oldest rather than grow without bound; the percentiles stay
      // representative and memory stays flat.
      target.shift();
    }
    target.push(value);
  }

  setConsecutiveDownloadFailures(count: number): void {
    this.counters.consecutiveDownloadFailures = Math.max(0, count);
  }

  /** Sends one sample and resets the counters. Failures drop the sample. */
  async flush(): Promise<void> {
    if (this.stopped) return;
    const now = this.now();
    const elapsedSeconds = Math.max(
      0,
      Math.round((now - this.lastFlushMs) / 1000),
    );
    const counters = this.counters;
    this.counters = emptyCounters();
    this.lastFlushMs = now;

    const drift = counters.syncDriftSamples.map(Math.abs);
    const sample = {
      observedAt: new Date(now).toISOString(),
      ...this.gauges(),
      interval: {
        seconds: elapsedSeconds,
        connectedSeconds: Math.round(counters.connectedSeconds),
        disconnectedSeconds: Math.round(counters.disconnectedSeconds),
        healthyPlaybackSeconds: Math.round(counters.healthyPlaybackSeconds),
        stalledPlaybackSeconds: Math.round(counters.stalledPlaybackSeconds),
        blackOutputSeconds: Math.round(counters.blackOutputSeconds),
        droppedFrames: counters.droppedFrames,
        frameChangeCount: counters.frameChangeCount,
        downloadedBytes: counters.downloadedBytes,
        cacheHits: counters.cacheHits,
        cacheMisses: counters.cacheMisses,
        consecutiveDownloadFailures: counters.consecutiveDownloadFailures,
        averageMemoryBytes: mean(counters.memorySamples),
        peakMemoryBytes:
          counters.memorySamples.length > 0
            ? Math.max(...counters.memorySamples)
            : undefined,
        averageCpuPercent: mean(counters.cpuSamples),
        thermalSeconds: counters.thermalSeconds,
        syncDriftP50Ms: percentile(drift, 0.5),
        syncDriftP95Ms: percentile(drift, 0.95),
        syncDriftMaxMs: drift.length > 0 ? Math.max(...drift) : undefined,
      },
    };

    try {
      await this.client.postTelemetry(sample);
    } catch {
      // Telemetry is not proof of play. A dropped sample loses a minute of
      // detail; buffering it would trade that for unbounded memory on a
      // player that has been offline for hours.
      log.debug("telemetry sample dropped");
    }
  }
}
