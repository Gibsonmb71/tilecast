import type { ManifestCountdownBarPlugin, ManifestPlugin } from "./types";

export interface ActiveCountdownBar {
  id: string;
  message: string;
  value: string;
  displayMode: "overlay" | "push";
  heightPx: number;
  priority: number;
  targetAt: string;
  completed: boolean;
}

const COMPLETION_DISPLAY_MS = 60_000;

function zonedParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      value("weekday"),
    ),
  };
}

/** Convert a calendar wall time in an IANA zone to an absolute instant. */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = desired;
  // Two passes cover ordinary offsets and DST boundary corrections without a
  // heavy timezone dependency. Intl remains the source of timezone truth.
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const correction = desired - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function candidateTargets(
  plugin: ManifestCountdownBarPlugin,
  now: Date,
): Date[] {
  const config = plugin.config;
  if (config.scheduleType === "one_time") {
    const parsed = Date.parse(config.oneTimeAt ?? "");
    return Number.isFinite(parsed) ? [new Date(parsed)] : [];
  }
  const match = /^(\d{2}):(\d{2})/.exec(config.targetTime ?? "");
  if (!match) return [];
  const current = zonedParts(now, config.timezone);
  const dateAnchor = Date.UTC(current.year, current.month - 1, current.day);
  const days = new Set(config.daysOfWeek ?? []);
  const result: Date[] = [];
  // A lead window may begin up to 30 days before its target. Looking in both
  // directions also retains completion text around the preceding occurrence.
  for (let offset = -31; offset <= 31; offset += 1) {
    const date = new Date(dateAnchor + offset * 86_400_000);
    if (!days.has(date.getUTCDay())) continue;
    result.push(
      zonedInstant(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        Number(match[1]),
        Number(match[2]),
        config.timezone,
      ),
    );
  }
  return result;
}

function countdownText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function resolveCountdownBar(
  plugins: ManifestPlugin[] | null | undefined,
  localNow: Date,
  clockOffsetMs = 0,
): ActiveCountdownBar | null {
  const now = new Date(localNow.getTime() + clockOffsetMs);
  const active: ActiveCountdownBar[] = [];
  for (const raw of plugins ?? []) {
    if (raw.type !== "countdown_bar" || raw.version !== 1) continue;
    const plugin = raw as ManifestCountdownBarPlugin;
    for (const target of candidateTargets(plugin, now)) {
      const remaining = target.getTime() - now.getTime();
      const completionText = plugin.config.completionText?.trim() ?? "";
      const completed =
        remaining <= 0 &&
        remaining >= -COMPLETION_DISPLAY_MS &&
        completionText.length > 0;
      if (
        remaining > plugin.config.leadTimeSeconds * 1_000 ||
        (remaining <= 0 && !completed)
      ) {
        continue;
      }
      active.push({
        id: plugin.id,
        message: plugin.config.message,
        value: completed ? completionText : countdownText(remaining),
        displayMode: plugin.config.displayMode,
        heightPx: Math.min(Math.max(plugin.config.heightPx, 40), 320),
        priority: plugin.config.priority,
        targetAt: target.toISOString(),
        completed,
      });
    }
  }
  active.sort(
    (left, right) =>
      right.priority - left.priority ||
      Date.parse(left.targetAt) - Date.parse(right.targetAt) ||
      left.id.localeCompare(right.id),
  );
  return active[0] ?? null;
}
