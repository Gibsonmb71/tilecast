/**
 * Verified, resumable media downloads.
 *
 * Each asset variant downloads to `<final>.part`. Interrupted transfers
 * resume with `Range` guarded by `If-Range: <etag>` so a variant that changed
 * server-side restarts cleanly instead of splicing bytes from two versions.
 * The file is promoted to its final name only after both the byte size and
 * the SHA-256 digest match the manifest; active content is therefore always
 * fully verified, and a failed download never disturbs a previously promoted
 * file.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { logger } from "./log";

const log = logger("download");

export interface DownloadRequest {
  url: string;
  headers: Record<string, string>;
  destination: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  /** ETag to send as If-Range when resuming a partial file. */
  etag?: string;
  signal?: AbortSignal;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function fileSize(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return null;
  }
}

/**
 * Transfer facts worth counting. A resume and an integrity failure are
 * separately reported because they mean different things: the first says the
 * link is unreliable, the second says the bytes arriving are wrong.
 */
export interface DownloadObserver {
  onResumed?(): void;
  onBytes?(bytes: number, durationMs: number): void;
  onIntegrityFailure?(): void;
  onFailure?(): void;
}

/**
 * Download one variant. Returns when the verified file exists at
 * `request.destination`. Throws DownloadError otherwise.
 */
export async function downloadVerified(
  request: DownloadRequest,
  fetchImpl: typeof fetch = fetch,
  observer?: DownloadObserver,
): Promise<void> {
  try {
    await transferVerified(request, fetchImpl, observer);
  } catch (err) {
    // Reported here rather than at each throw site, so a failure cannot be
    // counted twice or missed by a path added later.
    observer?.onFailure?.();
    throw err;
  }
}

async function transferVerified(
  request: DownloadRequest,
  fetchImpl: typeof fetch,
  observer?: DownloadObserver,
): Promise<void> {
  const startedAt = Date.now();
  // Already promoted and intact? Done. (Cheap size check first; hash check
  // happens at manifest verification time.)
  const existing = await fileSize(request.destination);
  if (existing === request.expectedSizeBytes) {
    return;
  }

  const partPath = request.destination + ".part";
  let offset = (await fileSize(partPath)) ?? 0;
  if (offset > request.expectedSizeBytes) {
    await fs.rm(partPath, { force: true });
    offset = 0;
  }

  const headers: Record<string, string> = { ...request.headers };
  if (offset > 0 && request.etag) {
    headers["Range"] = `bytes=${offset}-`;
    headers["If-Range"] = request.etag;
  } else if (offset > 0) {
    // Without a validator we cannot safely resume.
    await fs.rm(partPath, { force: true });
    offset = 0;
  }

  const response = await fetchImpl(request.url, {
    headers,
    signal: request.signal ?? null,
  });

  if (response.status === 200) {
    // Full body (fresh download, or If-Range mismatch): restart from zero.
    await fs.rm(partPath, { force: true });
    offset = 0;
  } else if (response.status === 206) {
    // Server honored the resume. Counted because a screen resuming constantly
    // has an unreliable link, which nothing else in telemetry would show.
    observer?.onResumed?.();
  } else if (response.status === 401 || response.status === 403) {
    throw new DownloadError(`download unauthorized: ${response.status}`, false);
  } else if (response.status === 404 || response.status === 410) {
    throw new DownloadError(`variant missing: ${response.status}`, false);
  } else {
    throw new DownloadError(`download failed: ${response.status}`, true);
  }

  if (!response.body) {
    throw new DownloadError("empty response body", true);
  }

  const handle = await fs.open(partPath, offset > 0 ? "r+" : "w", 0o600);
  try {
    let position = offset;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.length > 0) {
        await handle.write(value, 0, value.length, position);
        position += value.length;
        if (position > request.expectedSizeBytes) {
          throw new DownloadError(
            "server sent more bytes than expected",
            false,
          );
        }
      }
    }
    await handle.sync();
  } finally {
    await handle.close();
  }

  const finalSize = await fileSize(partPath);
  if (finalSize !== request.expectedSizeBytes) {
    // Short read — keep the .part for resumption and let the caller retry.
    throw new DownloadError(
      `incomplete download: ${finalSize} of ${request.expectedSizeBytes} bytes`,
      true,
    );
  }

  const digest = await sha256File(partPath);
  if (digest.toLowerCase() !== request.expectedSha256.toLowerCase()) {
    await fs.rm(partPath, { force: true });
    observer?.onIntegrityFailure?.();
    throw new DownloadError("sha-256 mismatch", true);
  }

  await fs.mkdir(path.dirname(request.destination), { recursive: true });
  await fs.rename(partPath, request.destination);
  observer?.onBytes?.(
    request.expectedSizeBytes - offset,
    Date.now() - startedAt,
  );
  log.info("variant downloaded", {
    destination: path.basename(request.destination),
    bytes: request.expectedSizeBytes,
  });
}
