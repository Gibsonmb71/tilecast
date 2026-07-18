import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  FileSliders,
  Image,
  Layers3,
  ListVideo,
  Monitor,
  MonitorCheck,
  Plus,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  Link,
  matchRoutes,
  useLocation,
  useNavigate,
  type RouteObject,
} from "react-router";
import { api } from "../api/client";
import type { Screen, ScreenStatus, User } from "../api/types";
import {
  studioRouteHandle,
  useStudioRoutes,
  type BreadcrumbResource,
} from "../navigation/studioRoutes";
import { Button, Dialog, IconButton } from "./ui";

type CommandResult = {
  id: string;
  label: string;
  description: string;
  to: string;
  category: "Screens" | "Studio";
  Icon: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
  score: number;
};

type Breadcrumb = { label: string; to: string };
type CommandProvider = {
  id: string;
  results: () => (Omit<CommandResult, "score"> & { keywords?: string[] })[];
};

const statusLabels: Record<ScreenStatus, string> = {
  online: "Online",
  recent: "Recently online",
  stale: "Stale",
  offline: "Offline",
  disabled: "Disabled",
  revoked: "Pairing revoked",
};

function platformShortcut() {
  if (typeof navigator === "undefined") return "⌘K";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

export function fuzzyScore(query: string, candidate: string) {
  const needle = query.trim().toLocaleLowerCase();
  const haystack = candidate.toLocaleLowerCase();
  if (!needle) return 1;
  const exactIndex = haystack.indexOf(needle);
  if (exactIndex >= 0)
    return 200 - exactIndex - (haystack.length - needle.length);

  let candidateIndex = 0;
  let gaps = 0;
  for (const character of needle) {
    const match = haystack.indexOf(character, candidateIndex);
    if (match < 0) return -1;
    gaps += match - candidateIndex;
    candidateIndex = match + 1;
  }
  return 100 - gaps - (haystack.length - needle.length);
}

function resultIcon(to: string) {
  if (to.startsWith("/screens")) return Monitor;
  if (to.startsWith("/assets")) return Image;
  if (to.startsWith("/playlists")) return ListVideo;
  if (to.startsWith("/layouts")) return Layers3;
  if (to.startsWith("/schedules")) return CalendarClock;
  if (to.startsWith("/settings")) return Settings;
  return FileSliders;
}

function collectRouteResults(routes: readonly RouteObject[]) {
  const results: Omit<CommandResult, "score">[] = [];
  const seen = new Set<string>();
  const visit = (route: RouteObject) => {
    const item = studioRouteHandle(route).search;
    if (item && !seen.has(item.to)) {
      seen.add(item.to);
      results.push({
        id: `route:${item.to}`,
        label: item.label,
        description: item.description,
        to: item.to,
        category: "Studio",
        Icon: resultIcon(item.to),
        keywords: item.keywords,
      } as Omit<CommandResult, "score"> & { keywords?: string[] });
    }
    route.children?.forEach(visit);
  };
  routes.forEach(visit);
  return results as (Omit<CommandResult, "score"> & { keywords?: string[] })[];
}

export function buildCommandResults(
  routes: readonly RouteObject[],
  screens: Screen[],
  query: string,
) {
  const providers: CommandProvider[] = [
    { id: "routes", results: () => collectRouteResults(routes) },
    {
      id: "screens",
      results: () =>
        screens.map((screen) => ({
          id: `screen:${screen.id}`,
          label: screen.name,
          description: `${statusLabels[screen.status]}${screen.location ? ` · ${screen.location}` : ""}`,
          to: `/screens/${screen.id}`,
          category: "Screens" as const,
          Icon: Monitor,
          keywords: [
            screen.location,
            screen.platform,
            "screen",
            "player",
          ].filter(Boolean),
        })),
    },
  ];

  return providers
    .flatMap((provider) => provider.results())
    .map((result) => ({
      ...result,
      score: fuzzyScore(
        query,
        [result.label, result.description, ...(result.keywords ?? [])].join(
          " ",
        ),
      ),
    }))
    .filter((result) => result.score >= 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12) as CommandResult[];
}

function breadcrumbQueryKey(resource?: BreadcrumbResource, id?: string) {
  switch (resource) {
    case "screen":
      return ["screens", id] as const;
    case "screen-group":
      return ["screen-groups", id] as const;
    case "widget":
      return ["assets", id] as const;
    case "data-source":
      return ["data-source", id] as const;
    case "playlist":
      return ["playlists", id] as const;
    case "layout":
      return ["layout", id] as const;
    case "schedule":
      return ["schedules", id] as const;
    default:
      return ["breadcrumb", "none"] as const;
  }
}

async function breadcrumbResourceName(
  resource: BreadcrumbResource,
  id: string,
) {
  switch (resource) {
    case "screen":
      return (await api.screen(id)).name;
    case "screen-group":
      return (await api.screenGroup(id)).name;
    case "widget":
      return (await api.asset(id)).name;
    case "data-source":
      return (await api.getDataSource(id)).name;
    case "playlist":
      return (await api.playlist(id)).name;
    case "layout":
      return (await api.layout(id)).name;
    case "schedule":
      return (await api.schedule(id)).name;
  }
}

function useBreadcrumbs(routes: readonly RouteObject[], pathname: string) {
  const matches = matchRoutes([...routes], pathname) ?? [];
  const breadcrumbMatches = matches.filter(
    (match) => studioRouteHandle(match.route).breadcrumb,
  );
  const resourceMatch = [...breadcrumbMatches]
    .reverse()
    .find((match) => studioRouteHandle(match.route).resource);
  const resource = resourceMatch
    ? studioRouteHandle(resourceMatch.route).resource
    : undefined;
  const resourceId = resourceMatch?.params.id;
  const resourceName = useQuery({
    queryKey: breadcrumbQueryKey(resource, resourceId),
    queryFn: () => breadcrumbResourceName(resource!, resourceId!),
    enabled: Boolean(resource && resourceId),
    staleTime: 30_000,
  });

  return breadcrumbMatches.map((match) => {
    const handle = studioRouteHandle(match.route);
    return {
      label:
        match === resourceMatch && resourceName.data
          ? resourceName.data
          : (handle.breadcrumb ?? ""),
      to: match.pathname,
    } satisfies Breadcrumb;
  });
}

function BreadcrumbTrail({ items }: { items: Breadcrumb[] }) {
  return (
    <nav className="topbar__breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.to}:${item.label}`}>
              {index > 0 && (
                <span className="topbar__breadcrumb-separator" aria-hidden>
                  /
                </span>
              )}
              {current ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function isModalTextInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const textInput =
    target.matches(
      'input:not([type="button"]):not([type="submit"]), textarea',
    ) || target.isContentEditable;
  return (
    textInput &&
    Boolean(target.closest('dialog, [role="dialog"], .modal, .drawer'))
  );
}

function CommandPalette({
  open,
  onClose,
  routes,
  screens,
}: {
  open: boolean;
  onClose: () => void;
  routes: readonly RouteObject[];
  screens: Screen[];
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(
    () => buildCommandResults(routes, screens, query),
    [query, routes, screens],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  useEffect(() => setActiveIndex(0), [query]);

  const select = (result?: CommandResult) => {
    if (!result) return;
    onClose();
    void navigate(result.to);
  };

  return (
    <Dialog
      open={open}
      title="Search Tilecast"
      className="command-palette-dialog"
      onClose={onClose}
    >
      <div className="command-palette">
        <label className="command-palette__input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search screens, media, playlists…"
            aria-label="Search Tilecast"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-results"
            aria-activedescendant={
              results[activeIndex] ? `command-result-${activeIndex}` : undefined
            }
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) =>
                  results.length ? (current + 1) % results.length : 0,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) =>
                  results.length
                    ? (current - 1 + results.length) % results.length
                    : 0,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                select(results[activeIndex]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>{platformShortcut()}</kbd>
        </label>
        <div
          className="command-palette__results"
          id="command-palette-results"
          role="listbox"
          aria-label="Search results"
        >
          {results.length ? (
            results.map((result, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                id={`command-result-${index}`}
                key={result.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(result)}
              >
                <result.Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{result.label}</strong>
                  <small>{result.description}</small>
                </span>
                <em>{result.category}</em>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))
          ) : (
            <p className="command-palette__empty">No matching destinations.</p>
          )}
        </div>
        <footer className="command-palette__footer">
          <span>↑↓ Move</span>
          <span>Enter Open</span>
          <span>Esc Close</span>
        </footer>
      </div>
    </Dialog>
  );
}

export function StudioTopbar({ user }: { user?: User }) {
  const routes = useStudioRoutes();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const breadcrumbs = useBreadcrumbs(routes, location.pathname);
  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 10_000,
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
    refetchInterval: 15_000,
  });
  const screenAlerts = (screens.data?.items ?? []).filter(
    (screen) => screen.status !== "online",
  );
  const deploymentAlerts = (deployments.data?.items ?? []).filter(
    (deployment) => deployment.failedCount > 0,
  );
  const alertCount = screenAlerts.length + deploymentAlerts.length;
  const canPair = user?.role === "owner" || user?.role === "administrator";
  const canCreate = user?.role !== "viewer";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() === "k" &&
        (event.metaKey || event.ctrlKey) &&
        !isModalTextInput(event.target)
      ) {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setCreateOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    setNotificationsOpen(false);
    setCreateOpen(false);
    setPaletteOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notificationsOpen && !createOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (notificationsOpen && !notificationsRef.current?.contains(target))
        setNotificationsOpen(false);
      if (createOpen && !createRef.current?.contains(target))
        setCreateOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [createOpen, notificationsOpen]);

  return (
    <header className="topbar">
      <div className="topbar__left">
        <BreadcrumbTrail items={breadcrumbs} />
      </div>
      <button
        className="topbar__search"
        type="button"
        aria-label="Search Tilecast"
        aria-haspopup="dialog"
        onClick={() => setPaletteOpen(true)}
      >
        <Search size={17} aria-hidden="true" />
        <span className="topbar__search-placeholder">
          Search screens, media, playlists…
        </span>
        <kbd>{platformShortcut()}</kbd>
      </button>
      <div className="topbar__utilities">
        <div className="topbar__notifications" ref={notificationsRef}>
          <IconButton
            label="Notifications"
            aria-haspopup="menu"
            aria-expanded={notificationsOpen}
            onClick={() => {
              setCreateOpen(false);
              setNotificationsOpen((open) => !open);
            }}
          >
            <Bell size={18} aria-hidden="true" />
            {alertCount > 0 && (
              <span className="topbar__notification-badge" aria-hidden="true">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </IconButton>
          {notificationsOpen && (
            <div className="topbar__popover topbar__alerts" role="menu">
              <header>
                <strong>Notifications</strong>
                <span>{alertCount || "No"} active</span>
              </header>
              {alertCount === 0 ? (
                <p>No screens or deployments need attention.</p>
              ) : (
                <div className="topbar__alert-list">
                  {screenAlerts.slice(0, 5).map((screen) => (
                    <Link
                      key={screen.id}
                      role="menuitem"
                      to={`/screens/${screen.id}`}
                    >
                      <span className="topbar__alert-marker" aria-hidden />
                      <span>
                        <strong>{screen.name}</strong>
                        <small>{statusLabels[screen.status]}</small>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  ))}
                  {deploymentAlerts.slice(0, 3).map((deployment) => (
                    <Link
                      key={deployment.id}
                      role="menuitem"
                      to="/settings/player/updates"
                    >
                      <span className="topbar__alert-marker" aria-hidden />
                      <span>
                        <strong>{deployment.name}</strong>
                        <small>
                          {deployment.failedCount} failed player update
                          {deployment.failedCount === 1 ? "" : "s"}
                        </small>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <span className="topbar__divider" aria-hidden="true" />
        {canPair && (
          <Link
            className="button button--secondary topbar__pair"
            to="/screens/pair"
            aria-label="Pair screen"
          >
            <MonitorCheck size={16} aria-hidden="true" />
            <span>Pair screen</span>
          </Link>
        )}
        {canCreate && (
          <div className="topbar__create" ref={createRef}>
            <Button
              variant="primary"
              aria-haspopup="menu"
              aria-expanded={createOpen}
              onClick={() => {
                setNotificationsOpen(false);
                setCreateOpen((open) => !open);
              }}
            >
              <Plus size={16} aria-hidden="true" /> Create
            </Button>
            {createOpen && (
              <div className="topbar__popover topbar__create-menu" role="menu">
                <Link role="menuitem" to="/assets">
                  <Upload size={16} aria-hidden="true" /> Upload content
                </Link>
                <Link role="menuitem" to="/schedules/new">
                  <CalendarClock size={16} aria-hidden="true" /> Create schedule
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        routes={routes}
        screens={screens.data?.items ?? []}
      />
    </header>
  );
}
