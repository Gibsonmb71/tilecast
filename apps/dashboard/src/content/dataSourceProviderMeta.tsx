// Provider presentation metadata for Data Sources: display labels, icons, and setup copy.
//
// This lives under content/ rather than in a page so that both the Data Sources page and the
// in-editor DataSourcePicker can render the same provider identity without pages/ and content/
// importing each other in a cycle.
import {
  AlertTriangle,
  Braces,
  CalendarDays,
  ClipboardList,
  CloudSun,
  Database,
  FileSpreadsheet,
  Rss,
  School,
  TableProperties,
  type LucideIcon,
} from "lucide-react";
import type { DataSourceDefinition, DataSourceProvider } from "../api/types";

export function providerLabel(provider: DataSourceProvider | null | undefined) {
  if (!provider) return "Data Source";
  return (
    (
      {
        rss: "RSS",
        csv: "CSV",
        json: "JSON",
        manual: "Manual Table",
        cap_alerts: "CAP Alerts",
        air_quality: "Air Quality",
      } as Record<string, string>
    )[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

// A generic icon mapping by icon identifier. Release-defined definitions declare an icon
// name; unknown identifiers fall back to a safe default so a new definition never breaks
// the gallery.
const sourceIconMap: Record<string, LucideIcon> = {
  calendar: CalendarDays,
  csv: FileSpreadsheet,
  spreadsheet: FileSpreadsheet,
  json: Braces,
  braces: Braces,
  table: TableProperties,
  manual: TableProperties,
  cloud_sun: CloudSun,
  weather: CloudSun,
  rss: Rss,
  feed: Rss,
  alert: AlertTriangle,
  transit: CalendarDays,
  school: School,
};

export function iconForIdentifier(icon: string | undefined, size = 28) {
  const Icon = (icon && sourceIconMap[icon]) || Database;
  return <Icon size={size} />;
}

// Gallery copy for the providers that predate release-defined definitions. Their catalog
// descriptions are written for the definition compiler ("Project a public RSS feed into
// typed records"); these say the same thing to an author choosing what to connect.
const galleryCopy: Record<string, string> = {
  calendar: "Public Google, Microsoft, Apple, or other ICS calendars.",
  rss: "News, announcements, blog posts, and published updates.",
  atom: "Atom entries from publishing systems and update feeds.",
  json: "Public API data mapped with simple JSON Pointer paths.",
  csv: "Upload a spreadsheet export or connect a hosted CSV URL.",
  manual: "Maintain a small typed dataset directly in Studio.",
  weather: "Cached current conditions and daily forecasts.",
  transit: "Public GTFS departures and service alerts.",
  cap_alerts: "Active public emergency alerts and instructions.",
  air_quality: "Current AQI, pollutants, pollen, and hourly forecasts.",
  form: "Collect submissions, approve them, and publish records to Widgets.",
};

export function providerGalleryDescription(definition: DataSourceDefinition) {
  if (!definition.legacyEditor) return definition.description;
  return galleryCopy[definition.id] ?? definition.description;
}

export type SetupCopy = {
  eyebrow: string;
  description: string;
  tip: string;
  steps: string[];
};

// resolveSetup returns the Studio setup copy for a Data Source. Release-defined sources use
// their catalog metadata (description and optional setup guidance); legacy providers keep
// their hardcoded editor copy.
export function resolveSetup(
  provider: DataSourceProvider,
  definition: DataSourceDefinition | undefined,
): SetupCopy {
  if (definition && !definition.legacyEditor) {
    return {
      eyebrow: definition.setup?.eyebrow ?? "Release-defined information",
      description: definition.description,
      tip: definition.setup?.tip ?? "",
      steps: definition.setup?.steps ?? [],
    };
  }
  return (
    createCopy[provider] ?? {
      eyebrow: definition?.category ?? "Data Source",
      description: definition?.description ?? "",
      tip: "",
      steps: [],
    }
  );
}

// sourceIcon prefers a release-defined definition's declared icon and falls back to the
// legacy provider icon.
export function sourceIcon(
  provider: DataSourceProvider,
  definition: DataSourceDefinition | undefined,
  size = 28,
) {
  if (definition && !definition.legacyEditor) {
    return iconForIdentifier(definition.icon, size);
  }
  return providerIcon(provider, size);
}

const createCopy: Record<string, SetupCopy> = {
  calendar: {
    eyebrow: "iCalendar feed",
    description:
      "Connect one or more public ICS calendars, choose which event details to expose, then preview real events before saving.",
    tip: "Use the public or secret iCalendar subscription URL, not the normal calendar webpage.",
    steps: [
      "Name the connection and paste the public ICS URL.",
      "Choose the event window, fields, and timezone.",
      "Preview real events, then save the Data Source.",
    ],
  },
  rss: {
    eyebrow: "News and updates",
    description:
      "Turn an RSS feed into clean, cached records for lists, tickers, tables, and layouts.",
    tip: "Paste the direct feed URL. It often ends in /feed, .xml, or .rss.",
    steps: [
      "Name the connection and paste the RSS feed URL.",
      "Choose the fields, item limit, and sort order.",
      "Preview the mapped posts, then save.",
    ],
  },
  atom: {
    eyebrow: "Published entries",
    description:
      "Turn an Atom feed into reusable records without making editors work through every technical option first.",
    tip: "Use the direct Atom XML URL rather than the website homepage.",
    steps: [
      "Name the connection and paste the Atom feed URL.",
      "Choose the fields, item limit, and sort order.",
      "Preview the mapped entries, then save.",
    ],
  },
  json: {
    eyebrow: "Structured API data",
    description:
      "Connect a public JSON endpoint, map its record paths, and verify the normalized result before saving.",
    tip: 'JSON Pointer paths begin with a slash. Use / for a top-level array or /items for { "items": [...] }.',
    steps: [
      "Paste the public JSON endpoint URL.",
      "Map the list path and the fields your Widgets need.",
      "Preview the mapped records, then save.",
    ],
  },
  csv: {
    eyebrow: "Spreadsheet data",
    description:
      "Upload a CSV or connect a hosted CSV, map its columns, and preview the rows Tilecast will cache.",
    tip: "Column names must match the first row of the CSV. Start with the title column; the others are optional.",
    steps: [
      "Upload a CSV file or paste a direct CSV URL.",
      "Map the column names and choose displayed fields.",
      "Preview the mapped rows, then save.",
    ],
  },
  manual: {
    eyebrow: "Editor-managed data",
    description:
      "Create a small typed table for announcements, prices, metrics, directories, and other reusable signage data.",
    tip: "Choose stable field keys because Widgets refer to them when selecting content.",
    steps: [
      "Define the typed columns your Widgets need.",
      "Enter up to 200 rows directly in Studio.",
      "Save and reuse the table across multiple Widgets.",
    ],
  },
  weather: {
    eyebrow: "Global forecast",
    description:
      "Cache current conditions and a seven-day forecast for one coordinate using MET Norway.",
    tip: "Use coordinates rounded to four decimals and the IANA timezone for the location.",
    steps: [
      "Enter the location label, coordinates, and timezone.",
      "Choose units and provide the required contact identity.",
      "Preview the normalized forecast, then save.",
    ],
  },
  transit: {
    eyebrow: "Public transport",
    description:
      "Join public GTFS schedules with realtime trip updates and optional service alerts.",
    tip: "Use stable stop IDs from the agency’s GTFS Static feed.",
    steps: [
      "Enter the Static and Realtime feed URLs.",
      "Choose stop IDs, route filters, and timezone.",
      "Preview departures and alerts, then save.",
    ],
  },
  cap_alerts: {
    eyebrow: "Public warnings",
    description:
      "Normalize active public CAP 1.2 warnings from direct XML or a feed index.",
    tip: "Area filters match the alert’s published area description.",
    steps: [
      "Enter the CAP document or index URL.",
      "Choose language, severity, and area filters.",
      "Preview active alerts, then save.",
    ],
  },
  air_quality: {
    eyebrow: "Environmental conditions",
    description:
      "Cache current AQI and hourly pollutant forecasts for one location.",
    tip: "Hosted Open-Meteo access requires noncommercial acknowledgement; commercial deployments use a self-hosted endpoint.",
    steps: [
      "Enter the location coordinates and timezone.",
      "Choose AQI standard and measurements.",
      "Confirm endpoint policy, preview, then save.",
    ],
  },
};

export function providerIcon(provider: DataSourceProvider, size = 28) {
  if (provider === "calendar") return <CalendarDays size={size} />;
  if (provider === "csv") return <FileSpreadsheet size={size} />;
  if (provider === "json") return <Braces size={size} />;
  if (provider === "manual") return <TableProperties size={size} />;
  if (provider === "weather") return <CloudSun size={size} />;
  if (provider === "air_quality") return <CloudSun size={size} />;
  if (provider === "transit") return <CalendarDays size={size} />;
  if (provider === "cap_alerts") return <Rss size={size} />;
  if (provider === "form") return <ClipboardList size={size} />;
  return <Rss size={size} />;
}
