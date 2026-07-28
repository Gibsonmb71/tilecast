import type { LucideIcon } from "lucide-react";
import {
  Accessibility,
  Archive,
  ArrowLeftRight,
  Building2,
  CalendarClock,
  DatabaseBackup,
  DownloadCloud,
  Globe,
  Image,
  LifeBuoy,
  MapPin,
  Palette,
  Play,
  Power,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Users,
  Wrench,
} from "lucide-react";
export type SettingsSectionId =
  | "general"
  | "branding"
  | "users"
  | "locations"
  | "playback"
  | "media"
  | "websites"
  | "scheduling"
  | "reliability"
  | "power"
  | "accessibility"
  | "player-updates"
  | "takeover"
  | "retention"
  | "backups"
  | "system"
  | "import-export"
  | "security"
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
      { id: "security", label: "Sign-in security", path: "security" },
      { id: "locations", label: "Locations", path: "locations" },
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
        id: "takeover",
        label: "Emergency management",
        path: "operations/takeover",
      },
      {
        id: "retention",
        label: "Data retention",
        path: "operations/retention",
      },
      {
        id: "backups",
        label: "Backup and restore",
        path: "operations/backups",
      },
      { id: "system", label: "System", path: "system" },
      {
        id: "import-export",
        label: "Import and export",
        path: "import-export",
      },
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
  { title: string; description: string; icon: LucideIcon }
> = {
  general: {
    icon: Building2,
    title: "General",
    description:
      "Organization identity, regional formats, and support details.",
  },
  branding: {
    icon: Palette,
    title: "Branding",
    description:
      "Organization identity and the fallback appearance shown by players.",
  },
  users: {
    icon: Users,
    title: "Users",
    description:
      "Give each person an individual sign-in and assign only the permissions they need. Appearance and density preferences remain separate for every account.",
  },
  security: {
    icon: ShieldCheck,
    title: "Sign-in security",
    description:
      "Decide who must use a second factor to sign in. Each person manages their own authenticator, passkeys, and recovery codes from Sign-in security in their account menu.",
  },
  locations: {
    icon: MapPin,
    title: "Locations",
    description:
      "Reusable buildings and campuses assigned to multiple screens, while room details stay on each player.",
  },
  playback: {
    icon: Play,
    title: "Playback",
    description:
      "Default playback, storage, delivery, synchronization, and diagnostics.",
  },
  media: {
    icon: Image,
    title: "Media",
    description:
      "Upload limits, delivery defaults, and future media-processing behavior.",
  },
  websites: {
    icon: Globe,
    title: "Websites",
    description:
      "Safe defaults for website playback, reloads, cookies, and failures.",
  },
  scheduling: {
    icon: CalendarClock,
    title: "Scheduling",
    description: "Schedule preparation, timing, and clock-warning defaults.",
  },
  reliability: {
    icon: LifeBuoy,
    title: "Reliability and kiosk",
    description:
      "Shared recovery with platform-specific Android and Linux kiosk controls.",
  },
  power: {
    icon: Power,
    title: "Active hours and power",
    description:
      "Player operating hours and best-effort Android sleep and wake behavior.",
  },
  accessibility: {
    icon: Accessibility,
    title: "Accessibility control",
    description:
      "Optional foreground-return assistance with explicit safety pauses.",
  },
  "player-updates": {
    icon: DownloadCloud,
    title: "Player updates",
    description: "Verified Tilecast Player releases and update deployments.",
  },
  takeover: {
    icon: Siren,
    title: "Emergency management",
    description:
      "Prepare event-specific playlists and automate emergency playback from official weather alerts.",
  },
  retention: {
    icon: Archive,
    title: "Data retention",
    description: "Bounded history and cleanup periods for operational records.",
  },
  backups: {
    icon: DatabaseBackup,
    title: "Backup and restore",
    description:
      "Create, verify, download, schedule, and restore full installation backups.",
  },
  system: {
    icon: Wrench,
    title: "System",
    description: "Safe diagnostics and deliberate maintenance actions.",
  },
  "import-export": {
    icon: ArrowLeftRight,
    title: "Import and export",
    description: "Portable, non-secret Tilecast configuration.",
  },
  preferences: {
    icon: SlidersHorizontal,
    title: "My preferences",
    description: "Appearance and workflow preferences for your Studio account.",
  },
};
