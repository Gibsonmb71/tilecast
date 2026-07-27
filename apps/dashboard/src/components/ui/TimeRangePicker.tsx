import { Select } from "./SignalSelect";

export type TimeRangePreset = "24h" | "7d" | "30d" | "custom";

export type ResolvedTimeRange = {
  from: string;
  to: string;
  /** How the range reads in prose, such as "last 24 hours". */
  label: string;
  /**
   * The equally long window immediately before this one, so a metric can be
   * compared against a like-for-like period. Absent for a custom range with
   * only one bound supplied, where the comparison would be arbitrary.
   */
  previous?: { from: string; to: string; label: string };
};

const presetDays: Record<Exclude<TimeRangePreset, "custom">, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

const presetLabels: Record<TimeRangePreset, string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
  custom: "the selected range",
};

/**
 * Turns the picker's state into absolute bounds plus the preceding window of
 * the same length. Accepts `now` so callers and tests can pin the clock.
 */
export function resolveTimeRange(
  preset: TimeRangePreset,
  customFrom = "",
  customTo = "",
  now: Date = new Date(),
): ResolvedTimeRange {
  const custom = preset === "custom";
  const to = custom && customTo ? new Date(customTo) : now;
  const from =
    custom && customFrom
      ? new Date(customFrom)
      : new Date(
          to.getTime() - presetDays[custom ? "24h" : preset] * 86_400_000,
        );
  const span = to.getTime() - from.getTime();
  const range: ResolvedTimeRange = {
    from: from.toISOString(),
    to: to.toISOString(),
    label: presetLabels[preset],
  };
  // A custom range missing a bound has no defensible length to step back by.
  if (custom && !(customFrom && customTo)) return range;
  return {
    ...range,
    previous: {
      from: new Date(from.getTime() - span).toISOString(),
      to: range.from,
      label: custom
        ? "the preceding period"
        : `previous ${presetLabels[preset].replace("last ", "")}`,
    },
  };
}

export function TimeRangePicker({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  className = "",
}: {
  preset: TimeRangePreset;
  onPresetChange: (preset: TimeRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`time-range ${className}`.trim()}
      role="group"
      aria-label="Date range"
    >
      <label className="time-range__field">
        <span>Date range</span>
        <Select
          value={preset}
          onChange={(event) =>
            onPresetChange(event.target.value as TimeRangePreset)
          }
        >
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="custom">Custom range</option>
        </Select>
      </label>
      {preset === "custom" && (
        <>
          <label className="time-range__field">
            <span>From</span>
            <input
              type="datetime-local"
              value={customFrom}
              max={customTo || undefined}
              onChange={(event) => onCustomFromChange(event.target.value)}
            />
          </label>
          <label className="time-range__field">
            <span>To</span>
            <input
              type="datetime-local"
              value={customTo}
              min={customFrom || undefined}
              onChange={(event) => onCustomToChange(event.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );
}
