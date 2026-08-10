import { describe, expect, it } from "vitest";
import {
  NOISE_HISTORY_BATCH,
  NoiseHistoryQueue,
  sanitizeNoiseHistoryBucket,
  type NoiseHistoryBucket,
} from "./noise-history";
import type { StateStore } from "./storage";

/** In-memory StateStore stand-in that can be handed to a second queue. */
function fakeStore(files = new Map<string, unknown>()): {
  store: StateStore;
  files: Map<string, unknown>;
} {
  const store = {
    async readJson<T>(name: string): Promise<T | null> {
      const value = files.get(name);
      return value === undefined
        ? null
        : (JSON.parse(JSON.stringify(value)) as T);
    },
    async writeJson(name: string, value: unknown): Promise<void> {
      files.set(name, JSON.parse(JSON.stringify(value)));
    },
    async delete(name: string): Promise<void> {
      files.delete(name);
    },
  } as unknown as StateStore;
  return { store, files };
}

const NOW = Date.UTC(2026, 7, 10, 12, 0, 0);

function bucket(
  offsetSeconds: number,
  overrides: Partial<NoiseHistoryBucket> = {},
): NoiseHistoryBucket {
  return {
    startedAt: new Date(NOW - offsetSeconds * 1000).toISOString(),
    averageLevel: 42,
    peakLevel: 61,
    monitoredMs: 10_000,
    warningMs: 1_500,
    loudMs: 500,
    triggerCount: 1,
    ...overrides,
  };
}

describe("noise history sanitation", () => {
  const retention = 7 * 24 * 60 * 60 * 1000;

  it("accepts an ordinary bucket and pins it to the ten-second grid", () => {
    // A timestamp inside a slot names that slot, so a retry cannot land a
    // second row for the same ten seconds under a slightly different key.
    const clean = sanitizeNoiseHistoryBucket(
      bucket(30, { startedAt: new Date(NOW - 30_007).toISOString() }),
      NOW,
      retention,
    );
    expect(clean?.startedAt).toBe(new Date(NOW - 40_000).toISOString());
  });

  it("refuses measurements that cannot be believed", () => {
    // A poisoned aggregate must never reach storage, a chart, or a CSV.
    const cases: Partial<NoiseHistoryBucket>[] = [
      { averageLevel: Number.NaN },
      { peakLevel: Number.POSITIVE_INFINITY },
      { monitoredMs: Number.NaN },
      { monitoredMs: 0 },
      { startedAt: "not a timestamp" },
      // Warning plus loud cannot exceed the time actually monitored.
      { monitoredMs: 1_000, warningMs: 900, loudMs: 900 },
    ];
    for (const overrides of cases) {
      expect(
        sanitizeNoiseHistoryBucket(bucket(30, overrides), NOW, retention),
      ).toBeNull();
    }
  });

  it("refuses history from the future or past its retention window", () => {
    expect(
      sanitizeNoiseHistoryBucket(bucket(-3600), NOW, retention),
    ).toBeNull();
    expect(
      sanitizeNoiseHistoryBucket(bucket(30 * 24 * 3600), NOW, retention),
    ).toBeNull();
  });

  it("carries no field that could hold audio", () => {
    const clean = sanitizeNoiseHistoryBucket(
      { ...bucket(30), samples: [0.1, 0.2], waveform: "AAAA", pcm: [1, 2] },
      NOW,
      retention,
    );
    expect(clean).not.toBeNull();
    expect(Object.keys(clean!).sort()).toEqual([
      "averageLevel",
      "loudMs",
      "monitoredMs",
      "peakLevel",
      "startedAt",
      "triggerCount",
      "warningMs",
    ]);
  });
});

describe("noise history queue", () => {
  it("keeps pending buckets across a restart", async () => {
    const { store, files } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    await queue.add(bucket(30));
    await queue.add(bucket(20));
    expect(queue.size()).toBe(2);

    // A new process, the same data directory.
    const restarted = new NoiseHistoryQueue(fakeStore(files).store, () => NOW);
    await restarted.load();
    expect(restarted.size()).toBe(2);
    expect(restarted.peekBatch()[0]?.startedAt).toBe(bucket(30).startedAt);
  });

  it("sends the oldest records first and caps the batch", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    for (let index = 300; index > 0; index -= 1) {
      await queue.add(bucket(index * 10));
    }
    const batch = queue.peekBatch();
    expect(batch).toHaveLength(NOISE_HISTORY_BATCH);
    expect(batch[0]?.startedAt).toBe(bucket(3000).startedAt);
    // Peeking is not consuming: an unacknowledged batch is still queued.
    expect(queue.size()).toBe(300);
  });

  it("removes only the acknowledged batch", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    for (let index = 200; index > 0; index -= 1) {
      await queue.add(bucket(index * 10));
    }
    const batch = queue.peekBatch();
    await queue.acknowledge(batch, batch.length);
    expect(queue.size()).toBe(200 - NOISE_HISTORY_BATCH);
    // The next batch continues where the first stopped.
    expect(queue.peekBatch()[0]?.startedAt).toBe(
      bucket((200 - NOISE_HISTORY_BATCH) * 10).startedAt,
    );
  });

  it("retains the batch when the heartbeat is not acknowledged", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    await queue.add(bucket(30));
    await queue.add(bucket(20));
    const batch = queue.peekBatch();
    // A timeout, a 5xx, or a server that stored nothing: no acknowledgement.
    await queue.acknowledge(batch, 0);
    expect(queue.size()).toBe(2);
    // And a partial acknowledgement leaves the rest for the next heartbeat.
    await queue.acknowledge(batch, 1);
    expect(queue.size()).toBe(1);
    expect(queue.peekBatch()[0]?.startedAt).toBe(bucket(20).startedAt);
  });

  it("never queues two records for the same ten seconds", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    await queue.add(bucket(30, { averageLevel: 40 }));
    await queue.add(bucket(30, { averageLevel: 55 }));
    expect(queue.size()).toBe(1);
    expect(queue.peekBatch()[0]?.averageLevel).toBe(55);
  });

  it("prunes records past the configured retention window", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    queue.setRetentionDays(1);
    await queue.load();
    await queue.add(bucket(60));
    // Two days old with a one-day window: refused rather than stored.
    expect(await queue.add(bucket(2 * 24 * 3600))).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it("drops the oldest records rather than growing without bound", async () => {
    const { store } = fakeStore();
    // A queue seeded past the hard ceiling, as a player offline for a week
    // would have. The ceiling has to hold whatever the retention window says.
    const files = new Map<string, unknown>();
    const seeded: NoiseHistoryBucket[] = [];
    for (let index = 61_000; index > 0; index -= 1) {
      seeded.push(bucket(index * 10));
    }
    files.set("noise-history.json", { records: seeded });
    const queue = new NoiseHistoryQueue(fakeStore(files).store, () => NOW);
    queue.setRetentionDays(30);
    await queue.load();
    expect(queue.size()).toBeLessThanOrEqual(60_480);
    // What survived is the newest end of the range.
    expect(
      queue.peekBatch()[0]!.startedAt > bucket(61_000 * 10).startedAt,
    ).toBe(true);
    expect(store).toBeDefined();
  });

  it("rejects a poisoned bucket instead of storing it", async () => {
    const { store } = fakeStore();
    const queue = new NoiseHistoryQueue(store, () => NOW);
    await queue.load();
    expect(await queue.add(bucket(30, { averageLevel: Number.NaN }))).toBe(
      false,
    );
    expect(queue.size()).toBe(0);
  });
});
