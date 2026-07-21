import { emergencyActive, findPlaylist, resolveSelection } from "./schedule";
import type { StoredManifest } from "./manifest";
import type { Presentation, PresentationItem } from "./player";
import type {
  Manifest,
  ManifestAsset,
  ManifestItem,
  ManifestSchedule,
} from "./types";

export interface SynchronizedPlaybackMetadata {
  groupId: string;
  anchorMs: number;
  durationsMs: number[];
}

export interface SynchronizedPlaybackPosition {
  index: number;
  offsetMs: number;
  remainingMs: number;
  occurrence: number;
}

export type PlayingPresentation = Extract<Presentation, { state: "playing" }>;
export type SynchronizedPlayingPresentation = PlayingPresentation & {
  synchronizedPlayback: SynchronizedPlaybackMetadata;
};

function positiveDuration(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : null;
}

/** Match Android's effective playlist durations for deterministic group timing. */
export function effectiveDurationMs(
  rendered: PresentationItem,
  manifestItem: ManifestItem | undefined,
  asset: ManifestAsset | undefined,
): number {
  const explicit = positiveDuration(
    manifestItem?.durationMs ?? rendered.durationMs,
  );
  if (explicit !== null) {
    return explicit;
  }

  if (
    rendered.kind === "website" ||
    rendered.kind === "widget" ||
    rendered.kind === "layout" ||
    rendered.kind === "youtube"
  ) {
    return 30_000;
  }

  if (rendered.kind === "video") {
    const start =
      manifestItem?.videoStartOffsetMs ?? rendered.videoStartOffsetMs ?? 0;
    const end =
      manifestItem?.videoEndOffsetMs ??
      rendered.videoEndOffsetMs ??
      (asset?.durationSeconds != null
        ? Math.round(asset.durationSeconds * 1_000)
        : null);
    if (end !== null) {
      return Math.max(1, end - start);
    }
  }

  return 10_000;
}

export function synchronizedPlaybackPosition(
  metadata: SynchronizedPlaybackMetadata,
  nowMs: number,
): SynchronizedPlaybackPosition {
  const durations = metadata.durationsMs.map((value) => Math.max(1, value));
  if (durations.length === 0) {
    return { index: 0, offsetMs: 0, remainingMs: 1, occurrence: 0 };
  }

  const cycleDuration = durations.reduce((sum, value) => sum + value, 0);
  const elapsed = Math.max(0, nowMs - metadata.anchorMs);
  const completedCycles = Math.floor(elapsed / cycleDuration);
  let withinCycle = elapsed % cycleDuration;
  let index = 0;
  while (index < durations.length - 1 && withinCycle >= durations[index]!) {
    withinCycle -= durations[index]!;
    index += 1;
  }

  const duration = durations[index]!;
  const offsetMs = Math.min(Math.floor(withinCycle), duration - 1);
  return {
    index,
    offsetMs,
    remainingMs: Math.max(1, duration - offsetMs),
    occurrence: completedCycles * durations.length + index,
  };
}

/**
 * Rotate a normal presentation so the renderer mounts the expected shared item
 * first and only waits for the remaining portion of that occurrence.
 */
export function projectSynchronizedPresentation(
  presentation: SynchronizedPlayingPresentation,
  position: SynchronizedPlaybackPosition,
  generation: number,
): SynchronizedPlayingPresentation {
  const items = presentation.items;
  if (items.length === 0) {
    return { ...presentation, generation };
  }

  const index = Math.min(Math.max(position.index, 0), items.length - 1);
  const rotated = [...items.slice(index), ...items.slice(0, index)].map(
    (item) => ({
      ...item,
    }),
  );
  const first = rotated[0]!;
  first.durationMs = position.remainingMs;
  if (first.kind === "video") {
    first.videoStartOffsetMs =
      (items[index]!.videoStartOffsetMs ?? 0) + position.offsetMs;
  }

  return {
    ...presentation,
    items: rotated,
    generation,
  };
}

function localDateParts(timezone: string, atMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function zonedLocalToEpochMs(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = targetAsUtc;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actual = localDateParts(timezone, guess);
      if (Object.values(actual).some((value) => !Number.isFinite(value))) {
        return null;
      }
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
      const correction = targetAsUtc - actualAsUtc;
      guess += correction;
      if (Math.abs(correction) < 1_000) {
        break;
      }
    }
    return guess;
  } catch {
    return null;
  }
}

function parseTime(value: string | null | undefined): {
  hour: number;
  minute: number;
} | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

function previousDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** Derive the same active-window start Android uses as a schedule anchor. */
export function schedulePlaybackAnchorMs(
  schedule: ManifestSchedule,
  nowMs: number,
): number | null {
  if (schedule.type === "one_time") {
    const start = Date.parse(schedule.oneTimeStart ?? "");
    return Number.isFinite(start) ? start : null;
  }

  const start = parseTime(schedule.dailyStart);
  const end = parseTime(schedule.dailyEnd);
  if (!start || !end) {
    return null;
  }

  let local;
  try {
    local = localDateParts(schedule.timezone, nowMs);
  } catch {
    return null;
  }
  if (Object.values(local).some((value) => !Number.isFinite(value))) {
    return null;
  }

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const nowMinutes = local.hour * 60 + local.minute;
  let date = { year: local.year, month: local.month, day: local.day };
  if (endMinutes <= startMinutes && nowMinutes < endMinutes) {
    date = previousDate(date.year, date.month, date.day);
  }

  return zonedLocalToEpochMs(
    schedule.timezone,
    date.year,
    date.month,
    date.day,
    start.hour,
    start.minute,
  );
}

function playlistItemMaps(manifest: Manifest) {
  const items = new Map<string, ManifestItem>();
  for (const playlist of [
    manifest.playlist,
    manifest.directFallbackPlaylist,
    ...(manifest.playlists ?? []),
  ]) {
    for (const item of playlist?.items ?? []) {
      items.set(item.id, item);
    }
  }
  return items;
}

/** Add shared-timeline metadata to a Linux playing presentation when grouped. */
export function enrichSynchronizedPresentation(
  presentation: Presentation,
  stored: StoredManifest | null,
  nowMs = Date.now(),
): Presentation | SynchronizedPlayingPresentation {
  if (presentation.state !== "playing" || !stored?.manifest.syncGroup) {
    return presentation;
  }

  const manifest = stored.manifest;
  // The top-of-function guard already proved a sync group exists, but that
  // narrowing does not survive rebinding stored.manifest to `manifest`.
  // Capture it in a locally-narrowed const so the accesses below type-check.
  const syncGroup = manifest.syncGroup;
  if (!syncGroup) {
    return presentation;
  }
  const selection = resolveSelection(manifest, new Date(nowMs));
  const playlist = findPlaylist(manifest, selection.playlistId);
  if (
    !playlist ||
    playlist.items.length === 0 ||
    presentation.items.length === 0
  ) {
    return presentation;
  }

  const epoch = Date.parse(syncGroup.playbackEpoch ?? "");
  if (!Number.isFinite(epoch)) {
    return presentation;
  }

  let anchorMs = epoch;
  if (
    selection.source === "emergency" &&
    emergencyActive(manifest, new Date(nowMs))
  ) {
    const emergencyAnchor = Date.parse(manifest.emergency?.activatedAt ?? "");
    if (Number.isFinite(emergencyAnchor)) {
      anchorMs = emergencyAnchor;
    }
  } else if (selection.source === "schedule" && selection.scheduleId) {
    const schedule = manifest.schedules.find(
      (candidate) => candidate.id === selection.scheduleId,
    );
    const scheduleAnchor = schedule
      ? schedulePlaybackAnchorMs(schedule, nowMs)
      : null;
    if (scheduleAnchor !== null) {
      anchorMs = scheduleAnchor;
    }
  }

  const manifestItems = playlistItemMaps(manifest);
  const assets = new Map(
    manifest.assets.map((asset) => [asset.variantId, asset]),
  );
  const durationsMs = presentation.items.map((rendered) => {
    const source = manifestItems.get(rendered.id);
    return effectiveDurationMs(
      rendered,
      source,
      source?.variantId ? assets.get(source.variantId) : undefined,
    );
  });

  return {
    ...presentation,
    synchronizedPlayback: {
      groupId: syncGroup.id,
      anchorMs,
      durationsMs,
    },
  };
}
