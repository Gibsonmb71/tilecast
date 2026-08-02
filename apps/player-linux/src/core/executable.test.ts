import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executableCandidates, resolveLinuxExecutable } from "./executable";

describe("executableCandidates", () => {
  it("prioritizes the provisioned UxPlay location before PATH", () => {
    expect(
      executableCandidates("uxplay", {
        PATH: "/usr/bin:/opt/tilecast/bin:/usr/local/bin",
      }),
    ).toEqual([
      "/usr/local/bin/uxplay",
      "/usr/bin/uxplay",
      "/bin/uxplay",
      "/opt/tilecast/bin/uxplay",
    ]);
  });

  it("ignores relative and empty PATH entries", () => {
    expect(executableCandidates("vainfo", { PATH: ":.:/usr/bin" })).toEqual([
      "/usr/bin/vainfo",
      "/usr/local/bin/vainfo",
      "/bin/vainfo",
    ]);
  });

  it("rejects names that could escape the executable lookup", () => {
    expect(() =>
      executableCandidates("../uxplay", { PATH: "/usr/bin" }),
    ).toThrow("Invalid host executable name");
  });
});

describe("resolveLinuxExecutable", () => {
  it("returns an absolute executable from PATH", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tilecast-executable-"));
    try {
      const executable = join(directory, "uxplay");
      await writeFile(executable, "#!/bin/sh\nexit 0\n");
      await chmod(executable, 0o755);

      await expect(
        resolveLinuxExecutable("uxplay", { PATH: directory }),
      ).resolves.toMatchObject({
        status: "resolved",
        path: executable,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a present but non-executable candidate separately", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tilecast-executable-"));
    try {
      const executable = join(directory, "uxplay");
      await writeFile(executable, "not executable\n");
      await chmod(executable, 0o644);

      await expect(
        resolveLinuxExecutable("uxplay", { PATH: directory }),
      ).resolves.toMatchObject({
        status: "not_executable",
        path: executable,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
