/**
 * Player time is server time plus a measured offset. Policy decisions must not
 * silently fall back to the device wall clock, because a kiosk may have a
 * stale RTC while still having a healthy connection to Tilecast.
 */
export interface ServerClockSnapshot {
  offsetMs: number;
  synchronizedAtMs: number | null;
}

export class ServerClock {
  private offset = 0;
  private synchronizedAt: number | null = null;

  constructor(private readonly localNow: () => number = Date.now) {}

  nowMs(): number {
    return this.localNow() + this.offset;
  }

  now(): Date {
    return new Date(this.nowMs());
  }

  get offsetMs(): number {
    return this.offset;
  }

  sync(serverTime: string, receivedAtMs = this.localNow()): number {
    const serverMs = Date.parse(serverTime);
    if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAtMs)) {
      return this.offset;
    }
    this.offset = serverMs - receivedAtMs;
    this.synchronizedAt = receivedAtMs;
    return this.offset;
  }

  restore(
    snapshot: Partial<ServerClockSnapshot> | number | null | undefined,
  ): void {
    const offset = typeof snapshot === "number" ? snapshot : snapshot?.offsetMs;
    if (typeof offset === "number" && Number.isFinite(offset)) {
      this.offset = offset;
      this.synchronizedAt =
        typeof snapshot === "object" && snapshot
          ? (snapshot.synchronizedAtMs ?? null)
          : null;
    }
  }

  snapshot(): ServerClockSnapshot {
    return { offsetMs: this.offset, synchronizedAtMs: this.synchronizedAt };
  }
}
