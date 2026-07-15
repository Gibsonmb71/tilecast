import {
  Activity,
  CalendarDays,
  Ellipsis,
  Home,
  Image,
  Blocks,
  Layers3,
  ListVideo,
  LogOut,
  Monitor,
  Settings,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "../components/Brand";
import { api } from "../api/client";
import { OperationsDashboard } from "./OperationsDashboard";

const nav = [
  ["Overview", "/", Home],
  ["Screens", "/screens", Monitor],
  ["Assets", "/assets", Image],
  ["Apps", "/apps", Blocks],
  ["Playlists", "/playlists", ListVideo],
  ["Layouts", "/layouts", Layers3],
  ["Schedules", "/schedules", CalendarDays],
  ["Activity", "/activity", Activity],
  ["Users", "/users", Users],
  ["Settings", "/settings", Settings],
] as const;

export function DashboardShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuButtonRef = useRef<HTMLButtonElement>(null);
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
    enabled: Boolean(auth.status?.authenticated),
  });
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
  const visibleNav = nav.filter(
    ([, to]) =>
      to !== "/users" ||
      ["owner", "administrator"].includes(auth.status?.user?.role ?? ""),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Brand compact />
        </div>
        <nav aria-label="Primary">
          {visibleNav.map(([label, to, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"} aria-label={label}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
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
              <Ellipsis size={18} aria-hidden="true" />
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
          <Outlet />
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
