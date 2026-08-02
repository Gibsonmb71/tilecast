/**
 * Deterministic executable discovery for Linux host integrations.
 *
 * Host tools are started directly, never through a shell. The resolver only
 * accepts a basename, checks fixed system locations before PATH, and returns
 * an absolute path only after confirming that it is a regular executable file.
 * This matters for dependencies Tilecast provisions itself: a display-manager
 * or Electron session can inherit a PATH that omits /usr/local/bin.
 */

import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

const EXECUTABLE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SAFE_SYSTEM_BIN_DIRECTORIES = [
  "/usr/bin",
  "/usr/local/bin",
  "/bin",
] as const;
const UXPLAY_DIRECTORIES = ["/usr/local/bin", "/usr/bin", "/bin"] as const;

export type ExecutableResolutionStatus =
  "resolved" | "not_found" | "not_executable";

export interface ExecutableResolution {
  name: string;
  status: ExecutableResolutionStatus;
  /** Absolute executable path when status is resolved or not_executable. */
  path: string | null;
  /** Every safe candidate checked, in lookup order. */
  candidates: string[];
}

export type ExecutableResolver = (
  name: string,
) => Promise<ExecutableResolution>;

export interface ExecutableEnvironment {
  PATH?: string;
}

function validateExecutableName(name: string): void {
  if (!EXECUTABLE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid host executable name: ${name}`);
  }
}

/**
 * Build candidates without invoking `which` or a shell.
 *
 * Empty and relative PATH entries are deliberately ignored. Standard command
 * lookup treats those as the current directory, which would let an unrelated
 * working-tree file shadow a host dependency. Absolute PATH entries remain
 * available for operator-installed tools outside the system directories.
 */
export function executableCandidates(
  name: string,
  environment: ExecutableEnvironment = process.env,
): string[] {
  validateExecutableName(name);
  const preferredDirectories =
    name === "uxplay" ? UXPLAY_DIRECTORIES : SAFE_SYSTEM_BIN_DIRECTORIES;
  const pathDirectories =
    typeof environment.PATH === "string"
      ? environment.PATH.split(delimiter).filter(
          (directory) =>
            directory.length > 0 &&
            isAbsolute(directory) &&
            !/[\u0000-\u001f\u007f]/.test(directory),
        )
      : [];
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const directory of [...preferredDirectories, ...pathDirectories]) {
    const candidate = join(directory, name);
    if (!seen.has(candidate)) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  }
  return candidates;
}

/** Resolve a Linux host tool to an absolute, executable regular file. */
export async function resolveLinuxExecutable(
  name: string,
  environment: ExecutableEnvironment = process.env,
): Promise<ExecutableResolution> {
  const candidates = executableCandidates(name, environment);
  let notExecutable: string | null = null;

  for (const candidate of candidates) {
    try {
      const details = await stat(candidate);
      if (!details.isFile()) {
        notExecutable ??= candidate;
        continue;
      }
      await access(candidate, fsConstants.X_OK);
      return {
        name,
        status: "resolved",
        path: candidate,
        candidates,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        continue;
      }
      // Permission errors and other filesystem failures are useful to report
      // as an unusable candidate rather than pretending the dependency is
      // absent. A later candidate can still win.
      notExecutable ??= candidate;
    }
  }

  return {
    name,
    status: notExecutable ? "not_executable" : "not_found",
    path: notExecutable,
    candidates,
  };
}

function candidateSummary(candidates: string[]): string {
  if (candidates.length === 0) return "no safe locations were available";
  const shown = candidates.slice(0, 8).join(", ");
  return candidates.length > 8 ? `${shown}, …` : shown;
}

/** A bounded, operator-useful description of a resolver result. */
export function describeExecutableResolution(
  resolution: ExecutableResolution,
): string {
  if (resolution.status === "resolved") {
    return `${resolution.name} resolved to ${resolution.path}`;
  }
  if (resolution.status === "not_executable") {
    return `${resolution.name} was found at ${resolution.path ?? "a checked location"} but is not executable; checked ${candidateSummary(resolution.candidates)}`;
  }
  return `${resolution.name} was not found; checked ${candidateSummary(resolution.candidates)}`;
}
