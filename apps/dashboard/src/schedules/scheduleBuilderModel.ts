import type {
  ScheduleInput,
  ScheduleTarget,
  Screen,
  ScreenGroup,
} from "../api/types";

export const scheduleWeekdays = [
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
  { value: 0, short: "Sun", long: "Sunday" },
] as const;

export type PriorityPreset = "normal" | "important" | "special" | "custom";

export function priorityPreset(priority: number): PriorityPreset {
  if (priority === 0) return "normal";
  if (priority === 100) return "important";
  if (priority === 500) return "special";
  return "custom";
}

export function priorityLabel(priority: number) {
  const preset = priorityPreset(priority);
  if (preset === "normal") return "Normal";
  if (preset === "important") return "Important";
  if (preset === "special") return "Special event";
  return `Custom (${priority})`;
}

export function scheduleIsDirty(
  current: ScheduleInput,
  baseline: ScheduleInput,
) {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export function setTargetSelected(
  targets: ScheduleTarget[],
  target: ScheduleTarget,
  selected: boolean,
) {
  const matches = (current: ScheduleTarget) =>
    current.type === target.type && current.id === target.id;
  if (!selected) return targets.filter((current) => !matches(current));
  return targets.some(matches) ? targets : [...targets, target];
}

export function conflictWinnerReason(
  winner: { priority: number; specificity: number },
  proposedPriority: number,
) {
  if (winner.priority !== proposedPriority)
    return "it has the highest priority";
  if (winner.specificity > 0) return "it targets the screen directly";
  return "it starts later under the precedence rules";
}

export function formatClock(value?: string) {
  if (!value) return "Not set";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hour, minute));
}

export function describeWeekdays(days: number[]) {
  const ordered = scheduleWeekdays.filter((day) => days.includes(day.value));
  const weekdayValues = [1, 2, 3, 4, 5];
  if (weekdayValues.every((day) => days.includes(day)) && days.length === 5)
    return "Monday through Friday";
  if (days.length === 7) return "every day";
  if (ordered.length === 1) return `every ${ordered[0]!.long}`;
  if (ordered.length === 0) return "no days selected";
  return ordered.map((day) => day.short).join(", ");
}

export function describeScheduleTiming(input: ScheduleInput) {
  if (input.type === "one_time") {
    if (!input.oneTimeStart || !input.oneTimeEnd)
      return "Choose a start and end time";
    const start = new Date(input.oneTimeStart);
    const end = new Date(input.oneTimeEnd);
    return `${start.toLocaleString()} to ${end.toLocaleString()}`;
  }
  const overnight = (input.dailyEnd ?? "") <= (input.dailyStart ?? "");
  const range = input.startDate
    ? `, beginning ${new Date(`${input.startDate}T00:00:00`).toLocaleDateString()}${input.endDate ? ` through ${new Date(`${input.endDate}T00:00:00`).toLocaleDateString()}` : ""}`
    : "";
  return `${describeWeekdays(input.daysOfWeek)} from ${formatClock(input.dailyStart)} to ${formatClock(input.dailyEnd)}${overnight ? " the following day" : ""}${range}`;
}

export function oneTimeDuration(input: ScheduleInput) {
  if (!input.oneTimeStart || !input.oneTimeEnd) return "Duration unavailable";
  const milliseconds =
    new Date(input.oneTimeEnd).getTime() -
    new Date(input.oneTimeStart).getTime();
  if (milliseconds <= 0) return "End must be after start";
  const minutes = Math.round(milliseconds / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remaining = minutes % 60;
  return [
    days && `${days} day${days === 1 ? "" : "s"}`,
    hours && `${hours} hr`,
    remaining && `${remaining} min`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function validateScheduleInput(input: ScheduleInput) {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = "Enter a schedule name.";
  if (!input.playlistId && !input.layoutId)
    errors.playlistId = "Choose a playlist or published Layout.";
  if (!input.timezone) errors.timezone = "Choose a timezone.";
  if (!input.targets.length)
    errors.targets = "Select at least one screen or group.";
  if (input.priority < -999 || input.priority > 999)
    errors.priority = "Priority must be between -999 and 999.";
  if (input.type === "weekly") {
    if (!input.daysOfWeek.length)
      errors.daysOfWeek = "Select at least one weekday.";
    if (!input.dailyStart || !input.dailyEnd)
      errors.time = "Choose start and end times.";
    if (input.startDate && input.endDate && input.endDate < input.startDate)
      errors.dateRange = "The end date must not be before the start date.";
  } else if (!input.oneTimeStart || !input.oneTimeEnd) {
    errors.oneTime = "Choose the event start and end.";
  } else if (new Date(input.oneTimeEnd) <= new Date(input.oneTimeStart)) {
    errors.oneTime = "The event end must be after its start.";
  }
  return errors;
}

export function countTargetScreens(
  targets: ScheduleTarget[],
  screens: Screen[],
  groups: ScreenGroup[],
) {
  const ids = new Set<string>();
  for (const target of targets) {
    if (target.type === "screen") ids.add(target.id);
    else
      for (const screen of groups.find((group) => group.id === target.id)
        ?.screens ?? [])
        ids.add(screen.id);
  }
  return (
    ids.size || targets.filter((target) => target.type === "screen").length
  );
}

export function schedulePreviewTimestamp(input: ScheduleInput) {
  if (input.type === "one_time" && input.oneTimeStart)
    return input.oneTimeStart;
  const start = input.dailyStart ?? "09:00";
  const now = new Date();
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    if (!input.daysOfWeek.includes(candidate.getDay())) continue;
    const [hour = 9, minute = 0] = start.split(":").map(Number);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate >= now || offset > 0) return candidate.toISOString();
  }
  return now.toISOString();
}
