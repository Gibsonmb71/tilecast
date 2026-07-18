import type { SettingDefinition } from "../api/types";

const legacyTimezoneAliases: Record<string, string> = {
  EST: "America/New_York",
  EDT: "America/New_York",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  MST: "America/Denver",
  MDT: "America/Denver",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
};

const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/;

export function normalizeLocalTime(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return localTimePattern.test(trimmed) ? trimmed.slice(0, 5) : trimmed;
}

export function normalizeTimezone(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return legacyTimezoneAliases[trimmed] ?? trimmed;
}

export function normalizeSettingValues(
  values: Record<string, unknown>,
  definitions: SettingDefinition[],
) {
  const normalized = { ...values };
  for (const definition of definitions) {
    if (!Object.hasOwn(normalized, definition.key)) continue;
    if (definition.type === "local_time")
      normalized[definition.key] = normalizeLocalTime(
        normalized[definition.key],
      );
    if (definition.type === "timezone")
      normalized[definition.key] = normalizeTimezone(
        normalized[definition.key],
      );
  }
  return normalized;
}

export function timezoneOptions(current: unknown) {
  const supported = (
    Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
  ).supportedValuesOf?.("timeZone");
  const zones = new Set([
    "UTC",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "Europe/London",
    ...(supported ?? []),
  ]);
  const normalizedCurrent = normalizeTimezone(current);
  if (
    normalizedCurrent === "UTC" ||
    (normalizedCurrent.includes("/") && normalizedCurrent.length < 200)
  )
    zones.add(normalizedCurrent);
  return [...zones].sort((left, right) =>
    timezoneLabel(left).localeCompare(timezoneLabel(right)),
  );
}

export function timezoneLabel(zone: string) {
  const common: Record<string, string> = {
    "America/New_York": "Eastern Time",
    "America/Chicago": "Central Time",
    "America/Denver": "Mountain Time",
    "America/Los_Angeles": "Pacific Time",
  };
  if (zone === "UTC") return "UTC";
  const friendly = common[zone];
  if (friendly) return `${friendly} (${zone})`;
  return zone.replaceAll("_", " ").replace("/", " — ");
}
