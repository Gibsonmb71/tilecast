/** Offline, timezone-aware schedule and takeover resolution. */

import type { Manifest, ManifestSchedule } from "./types";

export const manifestTakeover = (manifest: Manifest) =>
  manifest.takeover ?? manifest.emergency ?? null;

export interface Selection {
  playlistId: string | null;
  layoutId: string | null;
  scheduleId: string | null;
  takeoverId: string | null;
  source: string;
  /** Exact next schedule/takeover boundary, for prompt unattended changes. */
  nextTransitionAt: string | null;
  /** Start of the winning window, used as a synchronized-playback anchor. */
  playbackAnchor: string | null;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

interface Window {
  schedule: ManifestSchedule;
  start: number;
  end: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const weeklyWindowCache = new Map<
  string,
  Array<{ start: number; end: number }>
>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let value = formatters.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timezone, value);
  }
  return value;
}

function zonedParts(timezone: string, at: Date): ZonedParts | null {
  try {
    const parts = formatter(timezone).formatToParts(at);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? NaN);
    const value = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
    };
    return Object.values(value).every(Number.isFinite) ? value : null;
  } catch {
    return null;
  }
}

function dateString(parts: ZonedParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dateParts(value: string): ZonedParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
  };
}

function addDays(value: string, days: number): string {
  const parts = dateParts(value);
  if (!parts) return value;
  const date = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return date.toISOString().slice(0, 10);
}

function weekday(value: string): number {
  const parts = dateParts(value)!;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function parseClock(value: string | null | undefined): [number, number] | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

function sameParts(a: ZonedParts | null, b: ZonedParts): boolean {
  return (
    a !== null &&
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/**
 * Resolve a wall-clock minute in an IANA zone. Repeated times use the earlier
 * instant for starts and the later instant for ends. Gap times advance to the
 * first valid minute, matching Go and java.time.
 */
function resolveLocal(
  date: string,
  clock: [number, number],
  timezone: string,
  end: boolean,
): number | null {
  const day = dateParts(date);
  if (!day) return null;
  const wanted = { ...day, hour: clock[0], minute: clock[1] };
  const naive = Date.UTC(
    wanted.year,
    wanted.month - 1,
    wanted.day,
    wanted.hour,
    wanted.minute,
  );
  const matches = localCandidates(wanted, naive, timezone);
  if (matches.length > 0) return end ? matches.at(-1)! : matches[0]!;

  // A DST spring gap is at most a few hours. Walk wall-clock minutes, not
  // elapsed instants, to land on the zone's first valid local minute.
  for (let minute = 1; minute <= 180; minute += 1) {
    const shifted = new Date(naive + minute * 60_000);
    const shiftedWanted: ZonedParts = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
    };
    const shiftedMatches = localCandidates(
      shiftedWanted,
      shifted.getTime(),
      timezone,
    );
    if (shiftedMatches.length > 0) {
      return end ? shiftedMatches.at(-1)! : shiftedMatches[0]!;
    }
  }
  return null;
}

function localCandidates(
  wanted: ZonedParts,
  naive: number,
  timezone: string,
): number[] {
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 60 * 60 * 1000;
    const local = zonedParts(timezone, new Date(sample));
    if (local) {
      const localAsUtc = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
      );
      offsets.add(localAsUtc - sample);
    }
  }
  return [...offsets]
    .map((offset) => naive - offset)
    .filter((candidate) =>
      sameParts(zonedParts(timezone, new Date(candidate)), wanted),
    )
    .sort((a, b) => a - b);
}

function windows(schedule: ManifestSchedule, at: Date): Window[] {
  if (schedule.type === "one_time") {
    const start = Date.parse(schedule.oneTimeStart ?? "");
    const end = Date.parse(schedule.oneTimeEnd ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      ? [{ schedule, start, end }]
      : [];
  }
  if (schedule.type !== "weekly") return [];
  const local = zonedParts(schedule.timezone, at);
  const startClock = parseClock(schedule.dailyStart);
  const endClock = parseClock(schedule.dailyEnd);
  if (!local || !startClock || !endClock) return [];

  const today = dateString(local);
  const days = new Set(schedule.daysOfWeek ?? []);
  const cacheKey = [
    schedule.timezone,
    today,
    schedule.dailyStart,
    schedule.dailyEnd,
    [...days].sort((a, b) => a - b).join(","),
    schedule.startDate ?? "",
    schedule.endDate ?? "",
  ].join("|");
  const cached = weeklyWindowCache.get(cacheKey);
  if (cached) return cached.map((window) => ({ schedule, ...window }));
  const overnight =
    endClock[0] * 60 + endClock[1] <= startClock[0] * 60 + startClock[1];
  const result: Window[] = [];
  for (let offset = -1; offset <= 8; offset += 1) {
    const origin = addDays(today, offset);
    // Bounds belong to the window's start day. This is important for the
    // after-midnight portion of a schedule whose endDate was yesterday.
    if (
      !days.has(weekday(origin)) ||
      (schedule.startDate && origin < schedule.startDate) ||
      (schedule.endDate && origin > schedule.endDate)
    ) {
      continue;
    }
    const start = resolveLocal(origin, startClock, schedule.timezone, false);
    const end = resolveLocal(
      overnight ? addDays(origin, 1) : origin,
      endClock,
      schedule.timezone,
      true,
    );
    if (start !== null && end !== null && end > start) {
      result.push({ schedule, start, end });
    }
  }
  if (weeklyWindowCache.size >= 20_000) weeklyWindowCache.clear();
  weeklyWindowCache.set(
    cacheKey,
    result.map(({ start, end }) => ({ start, end })),
  );
  return result;
}

export function scheduleApplies(schedule: ManifestSchedule, at: Date): boolean {
  const now = at.getTime();
  return windows(schedule, at).some(
    (window) => now >= window.start && now < window.end,
  );
}

export function takeoverActive(manifest: Manifest, at: Date): boolean {
  const takeover = manifestTakeover(manifest);
  if (!takeover) return false;
  const start = Date.parse(takeover.activatedAt);
  const end = Date.parse(takeover.expiresAt);
  const now = at.getTime();
  return (
    Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end
  );
}

export function presentationOverrideActive(
  manifest: Manifest,
  at: Date,
): boolean {
  const override = manifest.presentationOverride;
  if (!override) return false;
  const start = Date.parse(override.startedAt);
  const end = override.expiresAt ? Date.parse(override.expiresAt) : Infinity;
  const now = at.getTime();
  return Number.isFinite(start) && now >= start && now < end;
}

export function resolveSelection(manifest: Manifest, at: Date): Selection {
  const now = at.getTime();
  const takeover = manifestTakeover(manifest);
  const override = manifest.presentationOverride ?? null;
  const allWindows = (manifest.schedules ?? []).flatMap((schedule) =>
    schedule.playlistId || schedule.layoutId ? windows(schedule, at) : [],
  );
  const futureTransitions = allWindows
    .flatMap((window) => [window.start, window.end])
    .filter((transition) => transition > now);
  if (takeover) {
    const starts = Date.parse(takeover.activatedAt);
    if (Number.isFinite(starts) && starts > now) futureTransitions.push(starts);
  }
  if (override) {
    const starts = Date.parse(override.startedAt);
    if (Number.isFinite(starts) && starts > now) futureTransitions.push(starts);
    if (override.expiresAt) {
      const expires = Date.parse(override.expiresAt);
      if (Number.isFinite(expires) && expires > now)
        futureTransitions.push(expires);
    }
  }
  const transition = nextTransition(futureTransitions);

  if (takeover && takeoverActive(manifest, at)) {
    const expires = Date.parse(takeover.expiresAt);
    if (Number.isFinite(expires) && expires > now)
      futureTransitions.push(expires);
    return {
      playlistId: takeover.playlistId,
      layoutId: null,
      scheduleId: null,
      takeoverId: takeover.id,
      source: "takeover",
      nextTransitionAt: nextTransition(futureTransitions),
      playbackAnchor: takeover.activatedAt,
    };
  }

  if (override && presentationOverrideActive(manifest, at)) {
    const playlistId =
      override.playlistId ??
      (override.contentType === "playlist" ? override.contentId : null);
    const layoutId =
      override.layoutId ??
      (override.contentType === "layout" ? override.contentId : null);
    return {
      playlistId,
      layoutId,
      scheduleId: null,
      takeoverId: null,
      source: "quick_present",
      nextTransitionAt: transition,
      playbackAnchor: override.startedAt,
    };
  }

  const winner = allWindows
    .filter((window) => now >= window.start && now < window.end)
    .sort(
      (a, b) =>
        b.schedule.priority - a.schedule.priority ||
        b.schedule.specificity - a.schedule.specificity ||
        b.start - a.start ||
        a.schedule.id.localeCompare(b.schedule.id),
    )[0];
  if (winner) {
    return {
      playlistId: winner.schedule.playlistId ?? null,
      layoutId: winner.schedule.layoutId ?? null,
      scheduleId: winner.schedule.id,
      takeoverId: null,
      source: "schedule",
      nextTransitionAt: transition,
      playbackAnchor: new Date(winner.start).toISOString(),
    };
  }

  const directPlaylist = manifest.playlist ?? manifest.directFallbackPlaylist;
  if (directPlaylist) {
    return {
      playlistId: directPlaylist.id,
      layoutId: null,
      scheduleId: null,
      takeoverId: null,
      source: "direct",
      nextTransitionAt: transition,
      playbackAnchor: null,
    };
  }
  const directLayout = (manifest.layout ?? manifest.directFallbackLayout) as
    { id: string } | null | undefined;
  if (directLayout) {
    return {
      playlistId: null,
      layoutId: directLayout.id,
      scheduleId: null,
      takeoverId: null,
      source: "direct",
      nextTransitionAt: transition,
      playbackAnchor: null,
    };
  }
  return {
    playlistId: null,
    layoutId: null,
    scheduleId: null,
    takeoverId: null,
    source: "none",
    nextTransitionAt: transition,
    playbackAnchor: null,
  };
}

function nextTransition(values: number[]): string | null {
  const value = values.length > 0 ? Math.min(...values) : NaN;
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

export function findPlaylist(manifest: Manifest, playlistId: string | null) {
  if (!playlistId) return null;
  if (manifest.playlist?.id === playlistId) return manifest.playlist;
  if (manifest.directFallbackPlaylist?.id === playlistId)
    return manifest.directFallbackPlaylist;
  return (
    (manifest.playlists ?? []).find((playlist) => playlist.id === playlistId) ??
    null
  );
}
