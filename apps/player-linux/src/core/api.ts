/**
 * Typed HTTP client for the Tilecast server.
 *
 * Every response is unwrapped from the `{"data": ...}` / `{"error": {...}}`
 * envelope. Errors carry the server's stable error code so callers can make
 * exact decisions — in particular, a stored device credential is cleared
 * only on `device_credential_invalid` or `device_credential_revoked`, never
 * on network failures, 5xx, or `screen_disabled`.
 */

import type {
  CommandResultReport,
  EnrollmentResult,
  Heartbeat,
  Identity,
  Manifest,
  PairingCreated,
  PairingPollResult,
  PlayerCommand,
  PlayerConfig,
  DeviceMetadata,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The stored credential is proven dead; only these codes may clear it. */
  get credentialRejected(): boolean {
    return (
      this.code === "device_credential_invalid" ||
      this.code === "device_credential_revoked"
    );
  }

  get screenDisabled(): boolean {
    return this.code === "screen_disabled";
  }
}

/** Network-level failure (DNS, refused, timeout) — always retryable. */
export class NetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export interface ConditionalResult<T> {
  /** null when the server answered 304 Not Modified. */
  value: T | null;
  etag: string | null;
  notModified: boolean;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiClient {
  constructor(
    readonly baseUrl: string,
    private credential: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  setCredential(credential: string | null): void {
    this.credential = credential;
  }

  get hasCredential(): boolean {
    return this.credential !== null;
  }

  authHeaders(): Record<string, string> {
    return this.credential
      ? { Authorization: `Bearer ${this.credential}` }
      : {};
  }

  url(path: string): string {
    return this.baseUrl.replace(/\/+$/, "") + path;
  }

  private async request(
    method: string,
    path: string,
    options: {
      body?: unknown;
      headers?: Record<string, string>;
      auth?: boolean;
    } = {},
  ): Promise<{ status: number; headers: Headers; json: unknown }> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (options.auth !== false && this.credential) {
      headers["Authorization"] = `Bearer ${this.credential}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : null,
        signal: controller.signal,
      });
    } catch (err) {
      throw new NetworkError(`request failed: ${method} ${path}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 304) {
      return { status: 304, headers: response.headers, json: null };
    }

    let json: unknown = null;
    const text = await response.text().catch(() => "");
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    if (!response.ok) {
      const errObj =
        json && typeof json === "object" && "error" in json
          ? (json as { error: { code?: string; message?: string } }).error
          : undefined;
      throw new ApiError(
        response.status,
        errObj?.code ?? `http_${response.status}`,
        errObj?.message ?? `${method} ${path} failed with ${response.status}`,
      );
    }

    return { status: response.status, headers: response.headers, json };
  }

  private static data<T>(json: unknown): T {
    if (json && typeof json === "object" && "data" in json) {
      return (json as { data: T }).data;
    }
    throw new NetworkError("response missing data envelope");
  }

  // ---- Bootstrap and pairing (no device auth) -----------------------------

  async identity(): Promise<Identity> {
    const res = await this.request("GET", "/api/v1/system/identity", {
      auth: false,
    });
    return ApiClient.data<Identity>(res.json);
  }

  async createPairingSession(
    installationId: string,
    metadata: DeviceMetadata,
  ): Promise<PairingCreated> {
    const res = await this.request("POST", "/api/v1/player/pairing-sessions", {
      auth: false,
      body: { installationId, metadata },
    });
    return ApiClient.data<PairingCreated>(res.json);
  }

  async pollPairingSession(
    id: string,
    pollSecret: string,
  ): Promise<PairingPollResult> {
    const res = await this.request(
      "GET",
      `/api/v1/player/pairing-sessions/${id}`,
      { auth: false, headers: { Authorization: `Pairing ${pollSecret}` } },
    );
    return ApiClient.data<PairingPollResult>(res.json);
  }

  async enroll(
    pairingSessionId: string,
    enrollmentToken: string,
  ): Promise<EnrollmentResult> {
    const res = await this.request("POST", "/api/v1/player/enroll", {
      auth: false,
      body: { pairingSessionId, enrollmentToken },
    });
    return ApiClient.data<EnrollmentResult>(res.json);
  }

  // ---- Device-authenticated ------------------------------------------------

  async manifest(etag: string | null): Promise<ConditionalResult<Manifest>> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-None-Match"] = etag;
    }
    const res = await this.request("GET", "/api/v1/player/manifest", {
      headers,
    });
    if (res.status === 304) {
      return { value: null, etag, notModified: true };
    }
    return {
      value: ApiClient.data<Manifest>(res.json),
      etag: res.headers.get("ETag"),
      notModified: false,
    };
  }

  async config(etag: string | null): Promise<ConditionalResult<PlayerConfig>> {
    const headers: Record<string, string> = {};
    if (etag) {
      headers["If-None-Match"] = etag;
    }
    const res = await this.request("GET", "/api/v1/player/config", { headers });
    if (res.status === 304) {
      return { value: null, etag, notModified: true };
    }
    return {
      value: ApiClient.data<PlayerConfig>(res.json),
      etag: res.headers.get("ETag"),
      notModified: false,
    };
  }

  async heartbeat(body: Heartbeat): Promise<void> {
    await this.request("POST", "/api/v1/player/heartbeat", { body });
  }

  async fetchCommands(): Promise<PlayerCommand[]> {
    const res = await this.request("GET", "/api/v1/player/commands");
    const data = ApiClient.data<{ items: PlayerCommand[] }>(res.json);
    return data.items ?? [];
  }

  async acknowledgeCommand(id: string): Promise<void> {
    await this.request("POST", `/api/v1/player/commands/${id}/acknowledge`);
  }

  async reportCommandResult(
    id: string,
    result: CommandResultReport,
  ): Promise<void> {
    await this.request("POST", `/api/v1/player/commands/${id}/result`, {
      body: {
        success: result.success,
        code: result.code.slice(0, 80),
        message: result.message.slice(0, 240),
      },
    });
  }

  /** Upload a bounded batch of append-only activity events (max 200). */
  async postActivityEvents(events: unknown[]): Promise<void> {
    await this.request("POST", "/api/v1/player/activity-events", {
      body: { events },
    });
  }

  /** Poll the live-preview lease. Returns raw session JSON (or null). */
  async previewSession(): Promise<Record<string, unknown> | null> {
    const res = await this.request("GET", "/api/v1/player/preview-session");
    return (res.json as { data?: Record<string, unknown> })?.data ?? null;
  }

  /** Upload a preview capture (or a failure status) as multipart form data. */
  async postPreview(form: FormData): Promise<void> {
    if (!this.credential) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await this.fetchImpl(this.url("/api/v1/player/preview"), {
        method: "POST",
        headers: { Authorization: `Bearer ${this.credential}` },
        body: form,
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        const text = await response.text().catch(() => "");
        const code = /"code"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? `http_${response.status}`;
        throw new ApiError(response.status, code, "preview upload rejected");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new NetworkError("preview upload failed", err);
    } finally {
      clearTimeout(timer);
    }
  }
}
