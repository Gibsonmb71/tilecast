import type { SettingDefinition } from "../api/types";
import type { SettingsSectionId } from "./settingsNavigation";

export const enumLabels: Record<string, string> = {
  managed_kiosk: "Managed Kiosk",
  standard: "Standard reliability",
  first_party: "First-party cookies",
  first_and_third_party: "First- and third-party cookies",
  download_only: "Download only",
  on_each_activation: "Reload on each activation",
  load_once: "Load once",
  fallback_image: "Fallback image",
  last_success: "Last successful page",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
  en_US: "English (United States)",
  contain: "Contain",
  cover: "Cover",
  stretch: "Stretch",
  disabled: "Disabled",
  enabled: "Enabled",
  none: "None",
  fade: "Fade",
  automatic: "Automatic",
  download: "Download",
  stream: "Stream",
  minimal: "Minimal",
  detailed: "Detailed",
  system: "System",
  light: "Light",
  dark: "Dark",
  comfortable: "Comfortable",
  compact: "Compact",
  grid: "Grid",
  list: "List",
  groups: "Groups",
  organization: "Organization default",
  sunday: "Sunday",
  monday: "Monday",
  locale: "Use locale",
  placeholder: "Tilecast placeholder",
  skip: "Skip item",
  interval: "Reload on an interval",
};
export const descriptions: Record<string, string> = {
  "player.cache.max_bytes":
    "Maximum storage Tilecast may use for downloaded content.",
  "player.cache.minimum_free_bytes":
    "Storage Tilecast keeps free for Android and other applications.",
  "player.download.automatic_threshold_bytes":
    "Largest item Automatic delivery will download instead of stream.",
  "power.active_hours_days": "Days when this player should operate normally.",
  "power.cec_assist_enabled":
    "Requests Android sleep and wake; compatible firmware may relay HDMI-CEC.",
  "power.black_screen_fallback":
    "Shows black and stops decoding when device sleep is unavailable. This may not turn off the television.",
  "accessibility.allowed_packages":
    "Applications that may remain in front during authorized maintenance.",
  "reliability.mode":
    "Managed Kiosk requires Android device-owner support and is not guaranteed on consumer TV firmware.",
};

export const subsectionOrder: Record<
  SettingsSectionId,
  { title: string; description?: string; keys?: string[]; prefix?: string[] }[]
> = {
  playback: [
    {
      title: "Playback defaults",
      keys: [
        "player.playback.default_fit_mode",
        "player.playback.default_volume",
        "player.playback.default_image_duration_seconds",
        "player.playback.default_transition",
        "player.playback.default_audio_enabled",
        "player.playback.resume_after_restart",
      ],
    },
    {
      title: "Storage and delivery",
      prefix: ["player.cache.", "player.download."],
    },
    { title: "Synchronization", prefix: ["player.sync."] },
    {
      title: "Identification and diagnostics",
      prefix: ["player.identify.", "player.diagnostics."],
    },
  ],
  reliability: [
    { title: "Reliability mode", keys: ["reliability.mode"] },
    {
      title: "Startup and presentation",
      keys: ["reliability.launch_after_boot", "reliability.immersive_mode"],
    },
    {
      title: "Watchdog and recovery",
      prefix: [
        "reliability.foreground_",
        "reliability.playback_",
        "reliability.webview_",
        "reliability.maximum_",
        "reliability.restart_",
        "reliability.safe_",
      ],
    },
    {
      title: "Managed Kiosk",
      description:
        "These controls take effect only when Android confirms compatible device-owner capability.",
      prefix: ["managed_kiosk."],
    },
  ],
  power: [
    {
      title: "Active hours",
      keys: [
        "power.active_hours_enabled",
        "power.active_hours_timezone",
        "power.active_hours_days",
        "power.active_hours_start",
        "power.active_hours_end",
      ],
    },
    {
      title: "Active-hour behavior",
      keys: [
        "power.startup_grace_seconds",
        "power.shutdown_prepare_seconds",
        "power.keep_screen_on",
        "power.sleep_outside_active_hours",
      ],
    },
    {
      title: "Power Assist",
      description:
        "Tilecast requests Android sleep and wake behavior. This is not direct HDMI-CEC control and results depend on device and TV firmware.",
      keys: ["power.cec_assist_enabled", "power.black_screen_fallback"],
    },
  ],
  accessibility: [
    {
      title: "Automatic return",
      keys: [
        "accessibility.control_assist_enabled",
        "accessibility.return_delay_seconds",
        "accessibility.maximum_returns",
        "accessibility.return_window_minutes",
      ],
    },
    {
      title: "Safety pauses",
      keys: [
        "accessibility.pause_during_updates",
        "accessibility.pause_during_admin_session",
      ],
    },
    {
      title: "Allowed maintenance applications",
      keys: ["accessibility.allowed_packages"],
    },
    { title: "Diagnostics", keys: ["accessibility.report_foreground_package"] },
  ],
  branding: [
    {
      title: "Player fallback screen",
      prefix: [
        "branding.no_content_",
        "branding.disabled_",
        "branding.footer_",
      ],
    },
  ],
  general: [
    {
      title: "Organization identity",
      prefix: ["organization.name", "organization.short"],
    },
    {
      title: "Regional formats",
      prefix: [
        "organization.timezone",
        "organization.locale",
        "organization.first",
        "organization.date",
        "organization.time_format",
      ],
    },
    { title: "Support details", prefix: ["organization.support"] },
  ],
  media: [
    {
      title: "Uploads and retention",
      prefix: [
        "media.upload",
        "media.keep",
        "media.temporary",
        "media.deleted",
      ],
    },
    {
      title: "Future video processing",
      prefix: ["media.video.max", "media.processing"],
    },
    {
      title: "Delivery defaults",
      prefix: ["media.video.default", "media.image.default"],
    },
  ],
  websites: [
    {
      title: "Page capabilities",
      prefix: [
        "website.default_javascript",
        "website.default_dom",
        "website.default_cookie",
        "website.private",
      ],
    },
    {
      title: "Loading and reloads",
      prefix: [
        "website.default_timeout",
        "website.default_reload",
        "website.minimum_refresh",
        "website.default_zoom",
      ],
    },
    {
      title: "Failure behavior",
      prefix: [
        "website.default_failure",
        "website.default_fallback",
        "website.clear_data",
      ],
    },
    { title: "Player overrides", prefix: ["player.website."] },
  ],
  scheduling: [{ title: "Schedule defaults", prefix: ["scheduling."] }],
  emergency: [
    { title: "Emergency takeover", prefix: ["emergency."] },
    { title: "Player commands", prefix: ["commands."] },
  ],
  retention: [
    {
      title: "Security and operational history",
      prefix: ["retention.audit", "retention.command", "retention.emergency"],
    },
    {
      title: "Cleanup periods",
      prefix: [
        "retention.player",
        "retention.expired",
        "retention.failed",
        "retention.deleted",
      ],
    },
    { title: "Diagnostic limits", prefix: ["retention.max"] },
  ],
  preferences: [
    {
      title: "Appearance",
      prefix: [
        "preference.appearance",
        "preference.density",
        "preference.reduced",
      ],
    },
    {
      title: "Dates and tables",
      prefix: ["preference.time", "preference.table"],
    },
    {
      title: "Default views",
      prefix: [
        "preference.content",
        "preference.screens",
        "preference.remember",
        "preference.hide",
      ],
    },
  ],
  users: [],
  "player-updates": [],
  system: [],
  "import-export": [],
};

export function groupsFor(
  section: SettingsSectionId,
  definitions: SettingDefinition[],
) {
  const used = new Set<string>();
  const groups = subsectionOrder[section]
    .map((group) => ({
      ...group,
      definitions: definitions.filter((definition) => {
        const match =
          group.keys?.includes(definition.key) ||
          group.prefix?.some((prefix) => definition.key.startsWith(prefix));
        if (match) used.add(definition.key);
        return match;
      }),
    }))
    .filter((group) => group.definitions.length > 0);
  const remaining = definitions.filter(
    (definition) => !used.has(definition.key),
  );
  if (remaining.length)
    groups.push({ title: "Additional settings", definitions: remaining });
  return groups;
}

export function descriptionFor(definition: SettingDefinition) {
  return (
    definition.description ||
    descriptions[definition.key] ||
    `Configure ${definition.title.toLowerCase()} for Tilecast.`
  );
}
export function enumLabel(value: string) {
  return (
    enumLabels[value] ??
    value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}
