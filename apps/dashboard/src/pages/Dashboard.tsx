import {
  Activity,
  CalendarDays,
  Database,
  Ellipsis,
  Home,
  Image,
  Blocks,
  Layers3,
  ListVideo,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "../components/Brand";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { api } from "../api/client";
import { OperationsDashboard } from "./OperationsDashboard";

type NavItem = readonly [label: string, to: string, icon: LucideIcon];

const pinnedNav = [
  ["Overview", "/", Home],
  ["Screens", "/screens", Monitor],
] as const satisfies readonly NavItem[];
const contentNav = [
  ["Media", "/assets", Image],
  ["Widgets", "/widgets", Blocks],
  ["Data Sources", "/data-sources", Database],
] as const satisfies readonly NavItem[];
const composeNav = [
  ["Playlists", "/playlists", ListVideo],
  ["Layouts", "/layouts", Layers3],
  ["Schedules", "/schedules", CalendarDays],
] as const satisfies readonly NavItem[];
const activityNav = [
  "Activity",
  "/activity",
  Activity,
] as const satisfies NavItem;
const settingsNav = [
  "Settings",
  "/settings",
  Settings,
] as const satisfies NavItem;
const nav = [
  ...pinnedNav,
  ...contentNav,
  ...composeNav,
  activityNav,
  settingsNav,
] as const;
const sidebarCompactKey = "tilecast.sidebar.compact";

function SidebarLink({ item }: { item: NavItem }) {
  const [label, to, Icon] = item;
  return (
    <NavLink to={to} end={to === "/"} aria-label={label}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function SidebarGroup({
  label,
  items,
}: {
  label: string;
  items: readonly NavItem[];
}) {
  const id = `sidebar-${label.toLowerCase()}-label`;
  return (
    <section className="sidebar__nav-group" aria-labelledby={id}>
      <h2 className="sidebar__nav-label" id={id}>
        {label}
      </h2>
      {items.map((item) => (
        <SidebarLink key={item[1]} item={item} />
      ))}
    </section>
  );
}

export function SidebarNavigation() {
  return (
    <nav aria-label="Primary">
      <div className="sidebar__nav-main">
        {pinnedNav.map((item) => (
          <SidebarLink key={item[1]} item={item} />
        ))}
        <SidebarGroup label="Content" items={contentNav} />
        <SidebarGroup label="Compose" items={composeNav} />
        <div className="sidebar__nav-standalone">
          <SidebarLink item={activityNav} />
        </div>
      </div>
      <div className="sidebar__nav-footer">
        <SidebarLink item={settingsNav} />
      </div>
    </nav>
  );
}

export function DashboardShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(() => {
    try {
      return window.localStorage.getItem(sidebarCompactKey) === "true";
    } catch {
      return false;
    }
  });
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuButtonRef = useRef<HTMLButtonElement>(null);
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
    enabled: Boolean(auth.status?.authenticated),
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(sidebarCompactKey, String(sidebarCompact));
    } catch {
      // The sidebar still works when browser storage is unavailable.
    }
  }, [sidebarCompact]);
  useEffect(() => {
    const values = preferences.data?.values;
    if (!values) return;
    const root = document.documentElement;
    root.dataset.theme =
      typeof values["preference.appearance"] === "string"
        ? values["preference.appearance"]
        : "system";
    root.dataset.density =
      typeof values["preference.density"] === "string"
        ? values["preference.density"]
        : "comfortable";
    root.dataset.reducedMotion = String(
      Boolean(values["preference.reduced_motion"]),
    );
  }, [preferences.data]);
  useEffect(() => {
    if (!auth.isLoading && !auth.status?.authenticated)
      void navigate(
        auth.status?.setupRequired
          ? "/setup"
          : `/login?returnTo=${encodeURIComponent(location.pathname)}`,
        { replace: true },
      );
  }, [auth.isLoading, auth.status, navigate, location.pathname]);
  useEffect(() => {
    if (!accountMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      )
        setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      accountMenuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);
  if (auth.isLoading || !auth.status?.authenticated) return null;
  const title =
    location.pathname === "/"
      ? "Overview"
      : (nav.find(
          (item) => item[1] !== "/" && location.pathname.startsWith(item[1]),
        )?.[0] ?? "Overview");
  return (
    <div
      className={`app-shell${sidebarCompact ? " app-shell--sidebar-compact" : ""}`}
    >
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__brand-logo sidebar__brand-logo--full">
            <Brand compact />
          </span>
          <button
            className="sidebar__compact-toggle"
            type="button"
            aria-label={sidebarCompact ? "Expand sidebar" : "Compact sidebar"}
            title={sidebarCompact ? "Expand sidebar" : "Compact sidebar"}
            onClick={() => setSidebarCompact((compact) => !compact)}
          >
            {sidebarCompact ? (
              <PanelLeftOpen size={18} aria-hidden="true" />
            ) : (
              <PanelLeftClose size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        <SidebarNavigation />
        <div className="sidebar__account">
          <span className="avatar" aria-hidden="true">
            {auth.status.user?.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar__account-copy">
            <strong>{auth.status.user?.name}</strong>
            <small>{auth.status.user?.role}</small>
          </span>
          <div className="account-menu" ref={accountMenuRef}>
            <button
              ref={accountMenuButtonRef}
              className="account-menu__trigger"
              type="button"
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-controls="sidebar-account-menu"
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              <Ellipsis
                className="account-menu__ellipsis"
                size={18}
                aria-hidden="true"
              />
              <span className="account-menu__mobile-avatar" aria-hidden="true">
                {auth.status.user?.name.slice(0, 1).toUpperCase()}
              </span>
            </button>
            {accountMenuOpen && (
              <div
                className="account-menu__popover"
                id="sidebar-account-menu"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    void auth.logout();
                  }}
                  disabled={auth.isSubmitting}
                >
                  <LogOut size={16} aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <h1>{title}</h1>
        </header>
        <main className="workspace__content">
          <RouteErrorBoundary key={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function FoundationPage() {
  return <OperationsDashboard />;
}

export function PlannedPage({
  feature,
  milestone,
}: {
  feature: string;
  milestone: number;
}) {
  return (
    <section className="empty-state">
      <span className="empty-state__index">M{milestone}</span>
      <h2>{feature} are not enabled yet.</h2>
      <p>
        This installation currently includes the Milestone 1 foundation.{" "}
        {feature} will be implemented and tested in Milestone {milestone}.
      </p>
      <NavLink className="text-link" to="/">
        Return to installation status
      </NavLink>
    </section>
  );
}
