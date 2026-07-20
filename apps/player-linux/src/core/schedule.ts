/**
 * Local schedule and emergency resolution.
 *
 * The player selects the active playlist entirely locally — with the device
 * clock and the schedules cached in the manifest — so weekly schedules keep
 * working offline indefinitely. Selection uses half-open [start, end)
 * intervals. Weekly windows are evaluated in the schedule's IANA timezone
 * via Intl (no bundled tz database), and an end at or before the start means
 * an overnight window belonging to the start day.
 *
 * Precedence: an active emergency always wins; otherwise the applicable
 * schedule with the highest priority (then specificity) wins; otherwise the
 * direct assignment / fallback plays. The caller re-evaluates on a short
 * timer and on clock/manifest changes, so DST transitions and one-time
 * boundaries are honored without fragile next-wakeup math.
 */

import type { Manifest, ManifestSchedule } from "./types";

export interface Selection {
  playlistId: string | null;
  /** Set when the active assignment is a Layout rather than a playlist. */
  layoutId: string | null;
  scheduleId: string | null;
  emergencyId: string | null;
  /** "emergency" | "schedule" | "direct" | "none" */
  source: string;
}

interface LocalTime {
  weekday: number; // 0 = Sunday .. 6 = Saturday (matches manifest daysOfWeek)
  minutes: number; // minutes since local midnight
  date: string; // YYYY-MM-DD in the schedule's timezone
}

function localTimeIn(timezone: string, at: Date): LocalTime | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return null; // unknown timezone: schedule cannot apply
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdays[get("weekday")];
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (weekday === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return {
    weekday,
    minutes: hour * 60 + minute,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function parseHHMM(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Is the schedule active at `at` (half-open interval semantics)? */
export function scheduleApplies(schedule: ManifestSchedule, at: Date): boolean {
  if (schedule.type === "one_time") {
    const start = schedule.oneTimeStart ? Date.parse(schedule.oneTimeStart) : NaN;
    const end = schedule.oneTimeEnd ? Date.parse(schedule.oneTimeEnd) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return false;
    }
    const t = at.getTime();
    return t >= start && t < end;
  }

  // Weekly.
  const local = localTimeIn(schedule.timezone, at);
  if (!local) {
    return false;
  }
  if (schedule.startDate && local.date < schedule.startDate) {
    return false;
  }
  if (schedule.endDate && local.date > schedule.endDate) {
    return false;
  }
  const start = parseHHMM(schedule.dailyStart);
  const end = parseHHMM(schedule.dailyEnd);
  if (start === null || end === null) {
    return false;
  }
  const days = new Set(schedule.daysOfWeek ?? []);
  if (end > start) {
    // Same-day window [start, end).
    return days.has(local.weekday) && local.minutes >= start && local.minutes < end;
  }
  // Overnight window belongs to the start day: active from start..midnight on
  // a selected day, and from midnight..end on the following day.
  const previousWeekday = (local.weekday + 6) % 7;
  if (days.has(local.weekday) && local.minutes >= start) {
    return true;
  }
  return days.has(previousWeekday) && local.minutes < end;
}

export function emergencyActive(manifest: Manifest, at: Date): boolean {
  const emergency = manifest.emergency;
  if (!emergency) {
    return false;
  }
  const start = Date.parse(emergency.activatedAt);
  const end = Date.parse(emergency.expiresAt);
  const t = at.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && t >= start && t < end;
}

/** Resolve what should be playing right now. */
export function resolveSelection(manifest: Manifest, at: Date): Selection {
  if (emergencyActive(manifest, at)) {
    return {
      playlistId: manifest.emergency!.playlistId,
      layoutId: null,
      scheduleId: null,
      emergencyId: manifest.emergency!.id,
      source: "emergency",
    };
  }

  const applicable = (manifest.schedules ?? [])
    .filter((s) => s.playlistId || s.layoutId)
    .filter((s) => scheduleApplies(s, at))
    .sort(
      (a, b) => b.priority - a.priority || b.specificity - a.specificity,
    );
  const winner = applicable[0];
  if (winner) {
    return {
      playlistId: winner.playlistId ?? null,
      layoutId: winner.layoutId ?? null,
      scheduleId: winner.id,
      emergencyId: null,
      source: "schedule",
    };
  }

  const directPlaylist = manifest.playlist ?? manifest.directFallbackPlaylist;
  if (directPlaylist) {
    return {
      playlistId: directPlaylist.id,
      layoutId: null,
      scheduleId: null,
      emergencyId: null,
      source: "direct",
    };
  }

  // A Layout may be assigned directly with no playlist.
  const directLayout = (manifest.layout ?? manifest.directFallbackLayout) as
    | { id: string }
    | null
    | undefined;
  if (directLayout) {
    return {
      playlistId: null,
      layoutId: directLayout.id,
      scheduleId: null,
      emergencyId: null,
      source: "direct",
    };
  }

  return {
    playlistId: null,
    layoutId: null,
    scheduleId: null,
    emergencyId: null,
    source: "none",
  };
}

export function findPlaylist(manifest: Manifest, playlistId: string | null) {
  if (!playlistId) {
    return null;
  }
  if (manifest.playlist?.id === playlistId) {
    return manifest.playlist;
  }
  if (manifest.directFallbackPlaylist?.id === playlistId) {
    return manifest.directFallbackPlaylist;
  }
  return (manifest.playlists ?? []).find((p) => p.id === playlistId) ?? null;
}
