// Guided jobs are the task-shaped entry into Studio: "show a lunch menu" rather than "create a
// Data Source, then a Widget, then a playlist, then an assignment".
//
// A job is only a recipe. It names the Widget provider to open and the Data Source providers that
// fit, and the flow then drives the ordinary editors and the ordinary APIs. Nothing it produces
// carries a marker saying a wizard made it, so every record stays editable exactly like a
// hand-built one.
import type { DataSourceProvider, WidgetProvider } from "../api/types";

export type GuidedJob = {
  id: string;
  title: string;
  // What the author gets, in their words rather than the data model's.
  outcome: string;
  // What step two builds, in a form that reads correctly after "Build the". Derived titles
  // produced things like "Build the a lunch menu", so each job states it.
  buildLabel: string;
  widgetProvider: WidgetProvider;
  // Data Source providers this job's Widget accepts. Empty means the Widget needs no data.
  dataProviders: readonly DataSourceProvider[];
  // Shown on the data step to explain what to connect.
  dataHint?: string;
  // Widgets have no intrinsic duration, so a playlist item needs one.
  durationMs: number;
};

export const guidedJobs: readonly GuidedJob[] = [
  {
    id: "calendar",
    title: "Show a calendar",
    outcome: "Upcoming events from a calendar feed, updating on their own.",
    buildLabel: "calendar",
    widgetProvider: "agenda",
    dataProviders: ["calendar"],
    dataHint:
      "Connect the calendar's public iCalendar (.ics) subscription URL, not the calendar webpage.",
    durationMs: 30_000,
  },
  {
    id: "lunch-menu",
    title: "Show a lunch menu",
    outcome: "Today's menu, read from a spreadsheet you already maintain.",
    buildLabel: "menu board",
    widgetProvider: "menu",
    dataProviders: ["csv", "manual"],
    dataHint:
      "Upload a CSV export, connect a hosted CSV, or type the menu into a small table.",
    durationMs: 30_000,
  },
  {
    id: "announcements",
    title: "Show announcements",
    outcome: "A rolling list of notices from a feed or a table you edit.",
    buildLabel: "announcements list",
    widgetProvider: "list",
    dataProviders: ["rss", "atom", "manual", "csv"],
    dataHint:
      "Connect a news or announcements feed, or maintain the list directly in Studio.",
    durationMs: 30_000,
  },
  {
    id: "countdown",
    title: "Count down to an event",
    outcome: "A countdown to a date and time. Needs no data connection.",
    buildLabel: "countdown",
    widgetProvider: "countdown",
    dataProviders: [],
    durationMs: 20_000,
  },
];

export function guidedJob(id: string | undefined) {
  return guidedJobs.find((job) => job.id === id);
}
