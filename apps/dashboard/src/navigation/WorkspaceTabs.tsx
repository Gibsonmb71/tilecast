// WorkspaceTabs turns several record-type pages into one workspace.
//
// Studio's navigation used to list six record types, so an author had to know the data model to
// know where to click. Media, Widgets, and Data are now facets of Content, and Playlists and
// Layouts are facets of Presentations, reachable from one sidebar entry each.
//
// The detail routes stay canonical (`/assets`, `/widgets`, `/data-sources`, `/playlists`,
// `/layouts`), so no deep link, breadcrumb, or search entry has to move. These are real links
// rather than buttons so a tab can be opened in a new tab like any other destination.
import { Link, useLocation } from "react-router";

export type WorkspaceTab = {
  label: string;
  to: string;
};

export const contentTabs: readonly WorkspaceTab[] = [
  { label: "Media", to: "/assets" },
  { label: "Widgets", to: "/widgets" },
  { label: "Data", to: "/data-sources" },
];

export const presentationTabs: readonly WorkspaceTab[] = [
  { label: "Playlists", to: "/playlists" },
  { label: "Layouts", to: "/layouts" },
];

// Every route beneath a tab's path belongs to that tab, so a Widget editor still shows Widgets as
// the current facet.
export function tabMatchesPath(to: string, pathname: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function WorkspaceTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: readonly WorkspaceTab[];
}) {
  const location = useLocation();
  return (
    <nav className="view-tabs workspace-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          aria-current={
            tabMatchesPath(tab.to, location.pathname) ? "page" : undefined
          }
        >
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
