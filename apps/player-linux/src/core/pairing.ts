/**
 * Pairing, enrollment, and credential persistence.
 *
 * The player installation UUID is created once and survives upgrades so the
 * server can recognize a previously paired screen. An in-flight pairing
 * session (ID, poll secret, visible code, expiry) is persisted and resumed
 * after a crash or restart, so a power cut mid-pairing never forces starting
 * over. The stored device credential is attempted first on startup and is
 * cleared only when an authenticated endpoint confirms it invalid or
 * revoked.
 */

import { randomUUID } from "crypto";
import * as os from "os";
import { ApiClient, ApiError, NetworkError } from "./api";
import { logger } from "./log";
import type { StateStore } from "./storage";
import type { DeviceMetadata, PairingCreated } from "./types";

const log = logger("pairing");

const IDENTITY_FILE = "installation.json";
const CREDENTIAL_FILE = "credential.json";
const PAIRING_FILE = "pairing-session.json";

interface InstallationRecord {
  playerInstallationId: string;
}

export interface CredentialRecord {
  serverUrl: string;
  installationId: string;
  screenId: string;
  screenName: string;
  deviceCredential: string;
  enrolledAt: string;
}

interface PairingRecord {
  serverUrl: string;
  installationId: string;
  sessionId: string;
  pollSecret: string;
  code: string;
  approvalUrl: string;
  expiresAt: string;
  pollingIntervalSeconds: number;
}

export async function loadOrCreateInstallationId(
  store: StateStore,
): Promise<string> {
  const existing = await store.readJson<InstallationRecord>(IDENTITY_FILE);
  if (existing?.playerInstallationId) {
    return existing.playerInstallationId;
  }
  const id = randomUUID();
  await store.writeJson(IDENTITY_FILE, { playerInstallationId: id });
  return id;
}

export async function loadCredential(
  store: StateStore,
): Promise<CredentialRecord | null> {
  return store.readJson<CredentialRecord>(CREDENTIAL_FILE);
}

export async function saveCredential(
  store: StateStore,
  record: CredentialRecord,
): Promise<void> {
  await store.writeJson(CREDENTIAL_FILE, record);
}

/** Only call after the server confirmed the credential invalid/revoked. */
export async function clearCredential(store: StateStore): Promise<void> {
  await store.delete(CREDENTIAL_FILE);
}

export function buildDeviceMetadata(input: {
  playerInstallationId: string;
  playerVersion: string;
  screenWidth: number;
  screenHeight: number;
}): DeviceMetadata {
  return {
    playerInstallationId: input.playerInstallationId,
    platform: "linux",
    manufacturer: os.hostname().slice(0, 120) || "unknown",
    model: `${os.type()} ${os.arch()}`.slice(0, 120),
    // Contract field name; carries the OS release string on Linux.
    androidVersion: os.release().slice(0, 120) || "unknown",
    playerVersion: input.playerVersion,
    screenWidth: clampDimension(input.screenWidth),
    screenHeight: clampDimension(input.screenHeight),
    density: 1,
    locale: (process.env.LANG?.split(".")[0] ?? "en_US").slice(0, 120),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone.slice(0, 120),
  };
}

function clampDimension(value: number): number {
  return Math.min(Math.max(Math.round(value) || 1, 1), 16384);
}

export interface PairingProgress {
  code: string;
  approvalUrl: string;
  expiresAt: string;
  organizationName?: string;
}

export interface PairingCallbacks {
  onWaitingForApproval(progress: PairingProgress): void;
  /** Session expired or was rejected; a fresh session will be created. */
  onSessionEnded(reason: string): void;
}

/**
 * Run pairing until an enrollment succeeds. Resumes a persisted session when
 * one is still valid, retries network failures indefinitely with the
 * server-provided polling interval, and creates a new session when the old
 * one expires or is rejected. Returns the stored credential record.
 */
export async function pairUntilEnrolled(
  store: StateStore,
  client: ApiClient,
  installationId: string,
  metadata: DeviceMetadata,
  callbacks: PairingCallbacks,
  sleep: (ms: number) => Promise<void>,
): Promise<CredentialRecord> {
  for (;;) {
    const session = await ensureSession(
      store,
      client,
      installationId,
      metadata,
      callbacks,
      sleep,
    );

    const credential = await pollSession(
      store,
      client,
      installationId,
      session,
      callbacks,
      sleep,
    );
    if (credential) {
      return credential;
    }
    // Session ended without enrollment; loop creates a fresh one.
  }
}

async function ensureSession(
  store: StateStore,
  client: ApiClient,
  installationId: string,
  metadata: DeviceMetadata,
  callbacks: PairingCallbacks,
  sleep: (ms: number) => Promise<void>,
): Promise<PairingRecord> {
  const persisted = await store.readJson<PairingRecord>(PAIRING_FILE);
  if (
    persisted &&
    persisted.serverUrl === client.baseUrl &&
    persisted.installationId === installationId &&
    Date.parse(persisted.expiresAt) > Date.now() + 5_000
  ) {
    log.info("resuming persisted pairing session", { code: persisted.code });
    return persisted;
  }
  await store.delete(PAIRING_FILE);

  for (;;) {
    try {
      const created: PairingCreated = await client.createPairingSession(
        installationId,
        metadata,
      );
      const record: PairingRecord = {
        serverUrl: client.baseUrl,
        installationId,
        sessionId: created.id,
        pollSecret: created.pollSecret,
        code: created.code,
        approvalUrl: created.approvalUrl,
        expiresAt: created.expiresAt,
        pollingIntervalSeconds: Math.max(created.pollingIntervalSeconds, 2),
      };
      await store.writeJson(PAIRING_FILE, record);
      callbacks.onWaitingForApproval({
        code: created.code,
        approvalUrl: created.approvalUrl,
        expiresAt: created.expiresAt,
        organizationName: created.organizationName,
      });
      return record;
    } catch (err) {
      log.warn("pairing session creation failed; retrying", {
        error: String(err),
      });
      await sleep(err instanceof NetworkError ? 5_000 : 15_000);
    }
  }
}

async function pollSession(
  store: StateStore,
  client: ApiClient,
  installationId: string,
  session: PairingRecord,
  callbacks: PairingCallbacks,
  sleep: (ms: number) => Promise<void>,
): Promise<CredentialRecord | null> {
  callbacks.onWaitingForApproval({
    code: session.code,
    approvalUrl: session.approvalUrl,
    expiresAt: session.expiresAt,
  });

  for (;;) {
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await store.delete(PAIRING_FILE);
      callbacks.onSessionEnded("expired");
      return null;
    }

    let result;
    try {
      result = await client.pollPairingSession(
        session.sessionId,
        session.pollSecret,
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        await store.delete(PAIRING_FILE);
        callbacks.onSessionEnded(err.code);
        return null;
      }
      log.warn("pairing poll failed; retrying", { error: String(err) });
      await sleep(session.pollingIntervalSeconds * 1_000);
      continue;
    }

    switch (result.status) {
      case "pending":
      case "approved":
        await sleep(session.pollingIntervalSeconds * 1_000);
        continue;
      case "claimed": {
        if (!result.enrollmentToken) {
          // Claimed by an earlier poll whose response we lost. The one-time
          // token is gone; only a fresh pairing can recover.
          await store.delete(PAIRING_FILE);
          callbacks.onSessionEnded("enrollment_token_lost");
          return null;
        }
        const credential = await enrollWithRetry(
          client,
          session,
          result.enrollmentToken,
          sleep,
        );
        if (!credential) {
          await store.delete(PAIRING_FILE);
          callbacks.onSessionEnded("enrollment_failed");
          return null;
        }
        const record: CredentialRecord = {
          serverUrl: client.baseUrl,
          installationId,
          screenId: credential.screenId,
          screenName: credential.screenName,
          deviceCredential: credential.deviceCredential,
          enrolledAt: new Date().toISOString(),
        };
        // Persist the credential before deleting pairing secrets so a crash
        // between the two writes cannot lose the enrollment.
        await saveCredential(store, record);
        await store.delete(PAIRING_FILE);
        log.info("enrolled", {
          screenId: record.screenId,
          screenName: record.screenName,
        });
        return record;
      }
      case "rejected":
      case "expired":
      default:
        await store.delete(PAIRING_FILE);
        callbacks.onSessionEnded(result.failureReason ?? result.status);
        return null;
    }
  }
}

async function enrollWithRetry(
  client: ApiClient,
  session: PairingRecord,
  token: string,
  sleep: (ms: number) => Promise<void>,
): Promise<{
  screenId: string;
  screenName: string;
  deviceCredential: string;
} | null> {
  // The token is one-time: retry only network failures, never a server
  // verdict.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await client.enroll(session.sessionId, token);
    } catch (err) {
      if (err instanceof NetworkError) {
        await sleep(3_000);
        continue;
      }
      log.error("enrollment rejected", { error: String(err) });
      return null;
    }
  }
  return null;
}
