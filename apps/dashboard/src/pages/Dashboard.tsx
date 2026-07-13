import {
  Activity,
  CalendarDays,
  Image,
  Layers3,
  ListVideo,
  Monitor,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { Brand } from "../components/Brand";
import { Button } from "../components/ui";
import { api } from "../api/client";

const nav = [
  ["Screens", "/screens", Monitor],
  ["Content", "/content", Image],
  ["Playlists", "/playlists", ListVideo],
  ["Layouts", "/layouts", Layers3],
  ["Schedules", "/schedules", CalendarDays],
  ["Activity", "/activity", Activity],
  ["Settings", "/settings", Settings],
] as const;

export function DashboardShell() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
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
  if (auth.isLoading || !auth.status?.authenticated) return null;
  const title =
    nav.find((item) => location.pathname.startsWith(item[1]))?.[0] ??
    "Overview";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Brand compact />
        </div>
        <nav aria-label="Primary">
          {nav.map(([label, to, Icon]) => (
            <NavLink key={to} to={to} aria-label={label}>
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__account">
          <span className="avatar" aria-hidden="true">
            {auth.status.user?.name.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{auth.status.user?.name}</strong>
            <small>{auth.status.user?.role}</small>
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <h1>{title}</h1>
          <Button
            variant="quiet"
            onClick={() => void auth.logout()}
            disabled={auth.isSubmitting}
          >
            Sign out
          </Button>
        </header>
        <main className="workspace__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function FoundationPage() {
  return (
    <div className="foundation">
      <section className="foundation__intro">
        <div className="status-badge">
          <ShieldCheck size={15} /> Foundation ready
        </div>
        <h2>Your Tilecast installation is running.</h2>
        <p>
          The server, database, dashboard, local accounts, and player pairing
          service are configured. Pair a TV from the Screens section.
        </p>
      </section>
      <section className="system-list" aria-label="Foundation services">
        <div>
          <span className="status-dot status-dot--ok" />
          <span>
            <strong>Application server</strong>
            <small>Serving the dashboard and versioned API</small>
          </span>
          <b>Operational</b>
        </div>
        <div>
          <span className="status-dot status-dot--ok" />
          <span>
            <strong>Local authentication</strong>
            <small>Owner session is active</small>
          </span>
          <b>Operational</b>
        </div>
        <div>
          <span className="status-dot status-dot--planned" />
          <span>
            <strong>Android TV players</strong>
            <small>
              Secure pairing and connection monitoring are available
            </small>
          </span>
          <b>Ready to pair</b>
        </div>
      </section>
    </div>
  );
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
