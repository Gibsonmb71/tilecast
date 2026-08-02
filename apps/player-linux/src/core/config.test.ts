import { describe, expect, it } from "vitest";
import { ConfigSync } from "./config";
import type { ApiClient } from "./api";
import type { PlayerConfig } from "./types";
import type { StateStore } from "./storage";

function store(): StateStore {
  const files = new Map<string, unknown>();
  return {
    async readJson<T>(name: string) {
      return (files.get(name) as T) ?? null;
    },
    async writeJson(name: string, value: unknown) {
      files.set(name, structuredClone(value));
    },
    async delete(name: string) {
      files.delete(name);
    },
  } as unknown as StateStore;
}

function config(revision: number): PlayerConfig {
  return {
    schemaVersion: 1,
    configRevision: revision,
    generatedAt: "2026-08-02T12:00:00Z",
    branding: {},
    playback: {},
    cache: {},
    sync: {},
    website: {},
    reliability: {},
    power: {},
    managedKiosk: {},
    accessibility: {},
    updates: {},
  };
}

describe("ConfigSync", () => {
  it("coalesces concurrent triggers and applies responses in revision order", async () => {
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstResponse = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const client = {
      config: async () => {
        calls += 1;
        if (calls === 1) {
          firstStarted!();
          await firstResponse;
          return { notModified: false, etag: "one", value: config(1) };
        }
        return { notModified: false, etag: "two", value: config(2) };
      },
    } as unknown as ApiClient;
    const applied: number[] = [];
    const sync = new ConfigSync(store(), client, {
      onConfigApplied: (value) => applied.push(value.configRevision),
      onCredentialRejected: () => undefined,
    });

    const first = sync.syncNow("socket");
    await started;
    const second = sync.syncNow("timer");
    releaseFirst!();
    await Promise.all([first, second]);

    expect(calls).toBe(2);
    expect(applied).toEqual([1, 2]);
    expect(sync.current?.configRevision).toBe(2);
  });
});
