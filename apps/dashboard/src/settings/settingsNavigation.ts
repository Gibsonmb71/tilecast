export type SettingsSectionId =
  | "general"
  | "branding"
  | "users"
  | "playback"
  | "media"
  | "websites"
  | "scheduling"
  | "reliability"
  | "power"
  | "accessibility"
  | "player-updates"
  | "emergency"
  | "retention"
  | "system"
  | "import-export"
  | "preferences";
export type SettingsNavigationItem = {
  id: SettingsSectionId;
  label: string;
  path: string;
};
export type SettingsNavigationGroup = {
  label: string;
  items: SettingsNavigationItem[];
};
export const settingsNavigation: SettingsNavigationGroup[] = [
  {
    label: "Organization",
    items: [
      { id: "general", label: "General", path: "general" },
      { id: "branding", label: "Branding", path: "branding" },
      { id: "users", label: "Users", path: "users" },
    ],
  },
  {
    label: "Content and playback",
    items: [
      { id: "playback", label: "Playback", path: "player/playback" },
      { id: "media", label: "Media", path: "content/media" },
      { id: "websites", label: "Websites", path: "content/websites" },
      { id: "scheduling", label: "Scheduling", path: "content/scheduling" },
    ],
  },
  {
    label: "Player management",
    items: [
      {
        id: "reliability",
        label: "Reliability and kiosk",
        path: "player/reliability",
      },
      { id: "power", label: "Active hours and power", path: "player/power" },
      {
        id: "accessibility",
        label: "Accessibility control",
        path: "player/accessibility",
      },
      { id: "player-updates", label: "Player updates", path: "player/updates" },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        id: "emergency",
        label: "Emergency and commands",
        path: "operations/emergency",
      },
      {
        id: "retention",
        label: "Data retention",
        path: "operations/retention",
      },
      { id: "system", label: "System", path: "system" },
      {
        id: "import-export",
        label: "Import and export",
        path: "import-export",
      },
    ],
  },
  {
    label: "Personal",
    items: [
      { id: "preferences", label: "My preferences", path: "preferences" },
    ],
  },
] as const;
export const settingsItems = settingsNavigation.flatMap((group) => group.items);
export function sectionFromPath(pathname: string): SettingsSectionId {
  const suffix = pathname.replace(/^\/settings\/?/, "").replace(/\/$/, "");
  return settingsItems.find((item) => item.path === suffix)?.id ?? "general";
}
export const sectionDetails: Record<
  SettingsSectionId,
  { title: string; description: string }
> = {
  general: {
    title: "General",
    description:
      "Organization identity, regional formats, and support details.",
  },
  branding: {
    title: "Branding",
    description:
      "Organization identity and the fallback appearance shown by players.",
  },
  users: {
    title: "Users",
    description:
      "Give each person an individual sign-in and assign only the permissions they need. Appearance and density preferences remain separate for every account.",
  },
  playback: {
    title: "Playback",
    description:
      "Default playback, storage, delivery, synchronization, and diagnostics.",
  },
  media: {
    title: "Media",
    description:
      "Upload limits, delivery defaults, and future media-processing behavior.",
  },
  websites: {
    title: "Websites",
    description:
      "Safe defaults for website playback, reloads, cookies, and failures.",
  },
  scheduling: {
    title: "Scheduling",
    description: "Schedule preparation, timing, and clock-warning defaults.",
  },
  reliability: {
    title: "Reliability and kiosk",
    description:
      "Startup behavior, bounded recovery, and capability-gated Managed Kiosk.",
  },
  power: {
    title: "Active hours and power",
    description:
      "Player operating hours and best-effort Android sleep and wake behavior.",
  },
  accessibility: {
    title: "Accessibility control",
    description:
      "Optional foreground-return assistance with explicit safety pauses.",
  },
  "player-updates": {
    title: "Player updates",
    description: "Verified Tilecast Player releases and update deployments.",
  },
  emergency: {
    title: "Emergency and commands",
    description:
      "Defaults for emergency takeover and persistent player operations.",
  },
  retention: {
    title: "Data retention",
    description: "Bounded history and cleanup periods for operational records.",
  },
  system: {
    title: "System",
    description: "Safe diagnostics and deliberate maintenance actions.",
  },
  "import-export": {
    title: "Import and export",
    description: "Portable, non-secret Tilecast configuration.",
  },
  preferences: {
    title: "My preferences",
    description: "Appearance and workflow preferences for your Studio account.",
  },
};
