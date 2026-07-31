/**
 * Ephemeral Studio live stream.
 *
 * This is deliberately independent from the persisted live-preview image.
 * While Studio holds a short lease, captures are sent as binary frames on the
 * authenticated player socket and are never written to player or server
 * storage.
 */

import type { ApiClient } from "./api";
import { logger } from "./log";

const ACTIVE_RECONCILE_MS = 5_000;
const IDLE_RECONCILE_MS = 15_000;
const MIN_CAPTURE_PAUSE_MS = 25;

export interface LiveStreamSession {
  id?: string;
  active: boolean;
  expiresAt?: string;
  frameIntervalMillis: number;
  maxWidth: number;
  maxHeight: number;
  maxFrameBytes: number;
}

export interface LiveStreamCapture {
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface LiveStreamHost {
  capture(max: {
    width: number;
    height: number;
    bytes: number;
  }): Promise<LiveStreamCapture | null>;
  send(
    sessionId: string,
    capturedAtMs: number,
    capture: LiveStreamCapture,
  ): boolean;
}

const log = logger("live-stream");

export class LiveStream {
  private session: LiveStreamSession | null = null;
  private reconcileTimer: NodeJS.Timeout | null = null;
  private captureTimer: NodeJS.Timeout | null = null;
  private reconciling = false;
  private stopped = false;

  constructor(
    private readonly client: ApiClient,
    private readonly host: LiveStreamHost,
    private readonly now: () => number,
  ) {}

  start(): void {
    this.stopped = false;
    void this.reconcile();
  }

  stop(): void {
    this.stopped = true;
    this.session = null;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.reconcileTimer = null;
    this.captureTimer = null;
  }

  sessionChanged(): void {
    if (this.stopped) return;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    void this.reconcile();
  }

  private async reconcile(): Promise<void> {
    if (this.stopped || this.reconciling) return;
    this.reconciling = true;
    let active = false;
    try {
      const session =
        (await this.client.liveStreamSession()) as unknown as LiveStreamSession;
      active = Boolean(
        session.active &&
        session.id &&
        session.expiresAt &&
        Date.parse(session.expiresAt) > this.now(),
      );
      this.session = active ? session : null;
      if (active) this.ensureCaptureLoop();
      else this.stopCaptureLoop();
    } catch (error) {
      log.debug("live stream session reconciliation failed", {
        error: String(error),
      });
    } finally {
      this.reconciling = false;
      if (!this.stopped) {
        this.reconcileTimer = setTimeout(
          () => void this.reconcile(),
          active ? ACTIVE_RECONCILE_MS : IDLE_RECONCILE_MS,
        );
        this.reconcileTimer.unref?.();
      }
    }
  }

  private ensureCaptureLoop(): void {
    if (this.captureTimer !== null) return;
    void this.captureOnce();
  }

  private stopCaptureLoop(): void {
    if (this.captureTimer) clearTimeout(this.captureTimer);
    this.captureTimer = null;
  }

  private async captureOnce(): Promise<void> {
    this.captureTimer = null;
    const session = this.session;
    if (
      this.stopped ||
      !session?.active ||
      !session.id ||
      !session.expiresAt ||
      Date.parse(session.expiresAt) <= this.now()
    ) {
      return;
    }
    const startedAt = this.now();
    try {
      const capture = await this.host.capture({
        width: session.maxWidth,
        height: session.maxHeight,
        bytes: session.maxFrameBytes,
      });
      if (capture && this.session?.id === session.id) {
        this.host.send(session.id, this.now(), capture);
      }
    } catch (error) {
      log.debug("live stream capture failed", { error: String(error) });
    }
    if (this.stopped || this.session?.id !== session.id) return;
    const elapsed = this.now() - startedAt;
    const delay = Math.max(
      MIN_CAPTURE_PAUSE_MS,
      session.frameIntervalMillis - elapsed,
    );
    this.captureTimer = setTimeout(() => void this.captureOnce(), delay);
    this.captureTimer.unref?.();
  }
}
