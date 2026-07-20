import { createHash } from "crypto";
import { mkdtempSync, readFileSync } from "fs";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { DownloadError, downloadVerified } from "./download";

const BODY = Buffer.from("tilecast media payload for verification tests");
const SHA = createHash("sha256").update(BODY).digest("hex");

function tempDest(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tilecast-dl-"));
  return path.join(dir, "asset-variant");
}

/** Minimal fetch fake supporting Range/If-Range like the server. */
function fakeFetch(options: { failIfRange?: boolean } = {}): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const range = headers.get("Range");
    if (range && !options.failIfRange) {
      const offset = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
      return new Response(new Uint8Array(BODY.subarray(offset)), {
        status: 206,
      });
    }
    return new Response(new Uint8Array(BODY), { status: 200 });
  }) as typeof fetch;
}

describe("downloadVerified", () => {
  it("downloads, verifies, and atomically promotes", async () => {
    const destination = tempDest();
    await downloadVerified(
      {
        url: "https://server/x",
        headers: {},
        destination,
        expectedSha256: SHA,
        expectedSizeBytes: BODY.length,
        etag: `"${SHA}"`,
      },
      fakeFetch(),
    );
    expect(readFileSync(destination)).toEqual(BODY);
    await expect(fs.stat(destination + ".part")).rejects.toThrow();
  });

  it("resumes a partial download with Range and still verifies", async () => {
    const destination = tempDest();
    await fs.writeFile(destination + ".part", BODY.subarray(0, 10));
    let sawRange: string | null = null;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      sawRange = new Headers(init?.headers).get("Range");
      return fakeFetch()(url as string, init);
    }) as typeof fetch;
    await downloadVerified(
      {
        url: "https://server/x",
        headers: {},
        destination,
        expectedSha256: SHA,
        expectedSizeBytes: BODY.length,
        etag: `"${SHA}"`,
      },
      fetchImpl,
    );
    expect(sawRange).toBe("bytes=10-");
    expect(readFileSync(destination)).toEqual(BODY);
  });

  it("restarts cleanly when If-Range misses (variant changed)", async () => {
    const destination = tempDest();
    await fs.writeFile(destination + ".part", Buffer.from("stale-old-bytes"));
    await downloadVerified(
      {
        url: "https://server/x",
        headers: {},
        destination,
        expectedSha256: SHA,
        expectedSizeBytes: BODY.length,
        etag: '"different-etag"',
      },
      fakeFetch({ failIfRange: true }), // server answers 200 full body
    );
    expect(readFileSync(destination)).toEqual(BODY);
  });

  it("rejects a hash mismatch and removes the tainted part file", async () => {
    const destination = tempDest();
    await expect(
      downloadVerified(
        {
          url: "https://server/x",
          headers: {},
          destination,
          expectedSha256: "0".repeat(64),
          expectedSizeBytes: BODY.length,
        },
        fakeFetch(),
      ),
    ).rejects.toThrow(DownloadError);
    await expect(fs.stat(destination)).rejects.toThrow();
    await expect(fs.stat(destination + ".part")).rejects.toThrow();
  });

  it("keeps the part file on a short read so the next attempt resumes", async () => {
    const destination = tempDest();
    const truncated = (async () =>
      new Response(new Uint8Array(BODY.subarray(0, 12)), {
        status: 200,
      })) as unknown as typeof fetch;
    await expect(
      downloadVerified(
        {
          url: "https://server/x",
          headers: {},
          destination,
          expectedSha256: SHA,
          expectedSizeBytes: BODY.length,
        },
        truncated,
      ),
    ).rejects.toThrow(/incomplete/);
    const stat = await fs.stat(destination + ".part");
    expect(stat.size).toBe(12);
  });

  it("skips work when the promoted file already exists", async () => {
    const destination = tempDest();
    await fs.writeFile(destination, BODY);
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response(null, { status: 500 });
    }) as unknown as typeof fetch;
    await downloadVerified(
      {
        url: "https://server/x",
        headers: {},
        destination,
        expectedSha256: SHA,
        expectedSizeBytes: BODY.length,
      },
      fetchImpl,
    );
    expect(called).toBe(false);
  });
});
