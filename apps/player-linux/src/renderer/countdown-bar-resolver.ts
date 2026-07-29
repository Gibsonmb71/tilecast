/**
 * Countdown Bar schedule resolution: which configured bar — if any — should be
 * on screen right now. Kept as a tiny global beside the countdown display
 * because renderer scripts run directly in the sandboxed page without module
 * imports, and shared so the renderer surface and its tests evaluate the exact
 * same weekly, one-time, DST, completion, and priority behavior.
 */
interface TilecastCountdownBarPlugin {
  id: string;
  type: string;
  version: number;
  config: {
    message: string;
    scheduleType: "weekly" | "one_time";
    targetTime?: string | null;
    daysOfWeek?: number[];
    oneTimeAt?: string | null;
    timezone: string;
    leadTimeSeconds: number;
    completionText?: string;
    displayMode: "overlay" | "push";
    heightPx: number;
    progressFill?: "none" | "drain" | null;
    priority: number;
  };
}

interface TilecastActiveCountdownBar {
  id: string;
  message: string;
  value: string;
  displayMode: "overlay" | "push";
  heightPx: number;
  priority: number;
  targetAt: string;
  completed: boolean;
  /**
   * Share of the lead window still to run, 1 when the bar first appears and 0 at
   * the target. Always 0 while completion text shows. `null` when the instance
   * asks for no fill, so the surface can leave the background alone rather than
   * paint a full-width tint.
   */
  remainingFraction: number | null;
}

interface TilecastCountdownBarResolver {
  resolve(
    plugins: TilecastCountdownBarPlugin[] | null | undefined,
    localNow: Date,
    clockOffsetMs?: number,
  ): TilecastActiveCountdownBar | null;
}

const tilecastCountdownBar: TilecastCountdownBarResolver = (() => {
  const COMPLETION_DISPLAY_MS = 60_000;
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // One formatter per zone: a bar re-resolves every second on hardware where
  // rebuilding Intl formatters is the most expensive part of the tick.
  const formatters = new Map<string, Intl.DateTimeFormat>();

  function formatter(timezone: string): Intl.DateTimeFormat {
    let cached = formatters.get(timezone);
    if (!cached) {
      cached = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        weekday: "short",
      });
      formatters.set(timezone, cached);
    }
    return cached;
  }

  function zonedParts(at: Date, timezone: string) {
    const parts = formatter(timezone).formatToParts(at);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return {
      year: Number(value("year")),
      month: Number(value("month")),
      day: Number(value("day")),
      hour: Number(value("hour")),
      minute: Number(value("minute")),
      second: Number(value("second")),
      weekday: WEEKDAYS.indexOf(value("weekday")),
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
  ): number {
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
    return guess;
  }

  function candidateTargets(
    plugin: TilecastCountdownBarPlugin,
    now: Date,
  ): number[] {
    const config = plugin.config;
    if (config.scheduleType === "one_time") {
      const instant = Date.parse(config.oneTimeAt ?? "");
      return Number.isFinite(instant) ? [instant] : [];
    }
    const match = /^(\d{2}):(\d{2})/.exec(config.targetTime ?? "");
    if (!match) return [];
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const current = zonedParts(now, config.timezone);
    const dateAnchor = Date.UTC(current.year, current.month - 1, current.day);
    const days = new Set(config.daysOfWeek ?? []);
    const targets: number[] = [];
    // A lead window may begin up to 30 days before its target. Looking in both
    // directions also retains completion text around the preceding occurrence.
    for (let offset = -31; offset <= 31; offset += 1) {
      const date = new Date(dateAnchor + offset * 86_400_000);
      if (!days.has(date.getUTCDay())) continue;
      targets.push(
        zonedInstant(
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
          hour,
          minute,
          config.timezone,
        ),
      );
    }
    return targets;
  }

  return Object.freeze({
    resolve(
      plugins: TilecastCountdownBarPlugin[] | null | undefined,
      localNow: Date,
      clockOffsetMs = 0,
    ): TilecastActiveCountdownBar | null {
      const now = localNow.getTime() + clockOffsetMs;
      const active: TilecastActiveCountdownBar[] = [];
      for (const plugin of plugins ?? []) {
        if (plugin.type !== "countdown_bar" || plugin.version !== 1) continue;
        for (const target of candidateTargets(plugin, new Date(now))) {
          const remaining = target - now;
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
          // A non-positive lead window would divide by zero; treat it as spent
          // rather than emitting NaN into a CSS width.
          const leadMs = plugin.config.leadTimeSeconds * 1_000;
          const fraction =
            leadMs > 0 ? Math.min(1, Math.max(0, remaining / leadMs)) : 0;
          active.push({
            id: plugin.id,
            message: plugin.config.message,
            value: completed
              ? completionText
              : tilecastCountdownDisplay.compact(remaining),
            displayMode: plugin.config.displayMode,
            heightPx: Math.min(Math.max(plugin.config.heightPx, 40), 320),
            priority: plugin.config.priority,
            targetAt: new Date(target).toISOString(),
            completed,
            remainingFraction:
              plugin.config.progressFill === "drain" ? fraction : null,
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
    },
  });
})();

// Exposed for unit tests only. In the player this is a plain global shared
// between the renderer scripts, which have no module loader.
(
  globalThis as typeof globalThis & {
    tilecastCountdownBar: TilecastCountdownBarResolver;
  }
).tilecastCountdownBar = tilecastCountdownBar;
