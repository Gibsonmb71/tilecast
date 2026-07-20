/**
 * Reconnect backoff policy.
 *
 * Bounded exponential backoff with full jitter. The failure streak resets
 * only after a connection has stayed healthy for a sustained period, so a
 * brief blip after a long stable session reconnects quickly while a genuinely
 * flapping link still walks up toward the cap instead of hammering the server.
 *
 * Pure and injectable (no timers, no Date.now inside decisions) so the policy
 * is unit-testable.
 */

export interface BackoffOptions {
  /** First retry delay in ms. */
  baseDelayMs: number;
  /** Upper bound for any computed delay in ms. */
  maxDelayMs: number;
  /**
   * A connection must stay up at least this long before a subsequent failure
   * is treated as a fresh outage (streak reset) rather than a continuation.
   */
  healthyResetMs: number;
  /** Random source, injectable for tests. Returns [0, 1). */
  random?: () => number;
}

export class ReconnectBackoff {
  private failures = 0;
  private connectedAtMs: number | null = null;
  private readonly random: () => number;

  constructor(private readonly options: BackoffOptions) {
    this.random = options.random ?? Math.random;
  }

  /** Record that a connection was established. */
  onConnected(nowMs: number): void {
    this.connectedAtMs = nowMs;
  }

  /**
   * Record that the connection failed or closed. Returns the delay in ms to
   * wait before the next attempt.
   */
  onDisconnected(nowMs: number): number {
    if (
      this.connectedAtMs !== null &&
      nowMs - this.connectedAtMs >= this.options.healthyResetMs
    ) {
      this.failures = 0;
    }
    this.connectedAtMs = null;
    this.failures += 1;
    return this.nextDelayMs();
  }

  /** Delay for the current failure streak with full jitter. */
  private nextDelayMs(): number {
    const exponent = Math.min(this.failures - 1, 16);
    const ceiling = Math.min(
      this.options.baseDelayMs * 2 ** exponent,
      this.options.maxDelayMs,
    );
    // Full jitter, but never less than half the base delay so a retry storm
    // cannot collapse to zero-length sleeps.
    const floor = Math.min(this.options.baseDelayMs / 2, ceiling);
    return Math.floor(floor + this.random() * (ceiling - floor));
  }

  get failureStreak(): number {
    return this.failures;
  }

  reset(): void {
    this.failures = 0;
    this.connectedAtMs = null;
  }
}
