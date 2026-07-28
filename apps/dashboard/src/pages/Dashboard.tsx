import {
  Activity,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Ellipsis,
  Home,
  Layers3,
  Library,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  contentTabs,
  presentationTabs,
  tabMatchesPath,
} from "../navigation/WorkspaceTabs";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "../components/Brand";
import { RouteErrorBoundary } from "../components/RouteErrorBoundary";
import { StudioTopbar } from "../components/StudioTopbar";
import { api } from "../api/client";
import { canReviewForm } from "../forms/capabilities";
import { OperationsDashboard } from "./OperationsDashboard";
import { EnrollmentGate } from "./SecurityPage";

// A nav item may own several routes: Content covers Media, Widgets, and Data, and Presentations
// covers Playlists and Layouts. `owns` lists those extra paths so the entry stays highlighted while
// the author moves between a workspace's submenu.
type NavItem = readonly [
  label: string,
  to: string,
  icon: LucideIcon,
  owns?: readonly string[],
];

// Seven destinations, each a task rather than a table. The record types are still first-class
// records with their own routes; they are reached as facets of a workspace instead of as peers in
// the sidebar.
const primaryNav = [
  ["Overview", "/", Home],
  ["Screens", "/screens", Monitor],
  ["Content", "/assets", Library, contentTabs.map((tab) => tab.to)],
  [
    "Presentations",
    "/playlists",
    Layers3,
    presentationTabs.map((tab) => tab.to),
  ],
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
const sidebarCompactKey = "tilecast.sidebar.compact";

function SidebarLink({ item }: { item: NavItem }) {
  const [label, to, Icon] = item;
  return (
    <NavLink
      to={to}
      end={to === "/"}
      aria-label={label}
      title={label}
      className={({ isActive }) => (isActive ? "active" : "")}
    >
      <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function SidebarWorkspace({
  item,
  tabs,
}: {
  item: NavItem;
  tabs: typeof contentTabs;
}) {
  const [label, to, ParentIcon] = item;
  const location = useLocation();
  const expanded = tabs.some((tab) =>
    tabMatchesPath(tab.to, location.pathname),
  );
  const submenuId = `sidebar-${label.toLowerCase()}-submenu`;
  return (
    <div className={`sidebar__nav-group${expanded ? " is-expanded" : ""}`}>
      <Link
        className="sidebar__parent"
        to={to}
        aria-expanded={expanded}
        aria-controls={submenuId}
        aria-label={label}
        title={label}
      >
        <ParentIcon size={20} strokeWidth={1.8} aria-hidden="true" />
        <span>{label}</span>
        <ChevronRight
          className="sidebar__parent-chevron"
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </Link>
      <div
        className="sidebar__submenu"
        id={submenuId}
        aria-label={`${label} submenu`}
        aria-hidden={!expanded}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isCurrent = tabMatchesPath(tab.to, location.pathname);
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              aria-current={isCurrent ? "page" : undefined}
              className={isCurrent ? "active" : ""}
              title={tab.label}
              tabIndex={expanded ? undefined : -1}
            >
              <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

const approvalsNav = [
  "Approvals",
  "/approvals",
  ClipboardCheck,
] as const satisfies NavItem;

export function SidebarNavigation() {
  // Approvals appears only when the user can review, approve, or manage at least one Form. The
  // accessible-forms query is shared (and cached) with the Forms portal.
  const forms = useQuery({
    queryKey: ["forms"],
    queryFn: api.listForms,
    retry: false,
  });
  const canReview = (forms.data ?? []).some((form) =>
    canReviewForm(form.grantedCapabilities),
  );
  return (
    <nav aria-label="Primary">
      <div className="sidebar__nav-main">
        {primaryNav.map((item) =>
          item[0] === "Content" ? (
            <SidebarWorkspace key={item[1]} item={item} tabs={contentTabs} />
          ) : item[0] === "Presentations" ? (
            <SidebarWorkspace
              key={item[1]}
              item={item}
              tabs={presentationTabs}
            />
          ) : (
            <SidebarLink key={item[1]} item={item} />
          ),
        )}
        <div className="sidebar__nav-standalone">
          <SidebarLink item={activityNav} />
          {canReview && <SidebarLink item={approvalsNav} />}
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
  // The server refuses every dashboard route until the required factor
  // exists, so the shell gives way to enrollment rather than rendering a page
  // whose data will not load.
  if (auth.status.mfaEnrollmentRequired) return <EnrollmentGate />;
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
            {auth.status.user?.name?.slice(0, 1).toUpperCase()}
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
                {auth.status.user?.name?.slice(0, 1).toUpperCase()}
              </span>
            </button>
            {accountMenuOpen && (
              <div
                className="account-menu__popover"
                id="sidebar-account-menu"
                role="menu"
              >
                <Link
                  to="/forms"
                  role="menuitem"
                  onClick={() => setAccountMenuOpen(false)}
                >
                  <ClipboardList size={16} aria-hidden="true" />
                  My Forms
                </Link>
                <Link
                  to="/preferences"
                  role="menuitem"
                  onClick={() => setAccountMenuOpen(false)}
                >
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  My preferences
                </Link>
                <Link
                  to="/security"
                  role="menuitem"
                  onClick={() => setAccountMenuOpen(false)}
                >
                  <ShieldCheck size={16} aria-hidden="true" />
                  Sign-in security
                </Link>
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
        <StudioTopbar
          user={auth.status.user}
          csrfToken={auth.status.csrfToken}
        />
        <main className="workspace__content">
          <RouteErrorBoundary key={location.pathname}>
            <div className="workspace__route">
              <Outlet />
            </div>
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
