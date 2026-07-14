import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  MonitorCheck,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type { Schedule, ScreenStatus } from "../api/types";
import "./OperationsDashboard.css";

const statusLabels: Record<ScreenStatus, string> = {
  online: "Online",
  recent: "Recently online",
  stale: "Stale",
  offline: "Offline",
  disabled: "Disabled",
  revoked: "Pairing revoked",
};

export function OperationsDashboard() {
  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 10_000,
  });
  const schedules = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules(),
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
    refetchInterval: 15_000,
  });

  const allScreens = screens.data?.items ?? [];
  const online = allScreens.filter((screen) => screen.status === "online");
  const attention = allScreens.filter((screen) => screen.status !== "online");
  const activeSchedules = (schedules.data?.items ?? []).filter(
    (schedule) => schedule.enabled,
  );
  const updateActions = (deployments.data?.items ?? []).reduce(
    (total, deployment) =>
      total + deployment.waitingForUserCount + deployment.failedCount,
    0,
  );
  const latestDeployment = deployments.data?.items[0];
  const nextChange = nextScheduleChange(activeSchedules);

  return (
    <div className="ops-console">
      <header className="ops-header">
        <div>
          <h2>System overview</h2>
          <p>
            Live player state, items requiring attention, and what changes next.
          </p>
        </div>
        <div className="ops-actions" aria-label="Quick actions">
          <Link className="button button--primary" to="/screens/pair">
            <MonitorCheck size={16} aria-hidden="true" /> Pair screen
          </Link>
          <details className="ops-create-menu">
            <summary className="button button--secondary">
              <Plus size={16} aria-hidden="true" /> Create
            </summary>
            <div>
              <Link to="/content">
                <Upload size={16} aria-hidden="true" /> Upload content
              </Link>
              <Link to="/schedules/new">
                <CalendarClock size={16} aria-hidden="true" /> Create schedule
              </Link>
            </div>
          </details>
        </div>
      </header>

      <section className="ops-summary" aria-label="Current status">
        <Summary
          value={`${online.length}/${allScreens.length}`}
          label="Screens online"
        />
        <Summary
          value={String(attention.length)}
          label="Need attention"
          urgent={attention.length > 0}
        />
        <Summary
          value={String(activeSchedules.length)}
          label="Active schedules"
        />
        <Summary
          value={String(updateActions)}
          label="Update actions"
          urgent={updateActions > 0}
        />
      </section>

      {attention.length > 0 && (
        <section className="ops-attention" aria-labelledby="attention-heading">
          <header>
            <div>
              <h3 id="attention-heading">
                <CircleAlert size={18} aria-hidden="true" /> Needs attention
              </h3>
              <p>
                Players below are not currently reporting an online connection.
              </p>
            </div>
            <Link to="/screens">View all screens</Link>
          </header>
          <div className="ops-attention-list">
            {attention.slice(0, 5).map((screen) => (
              <Link key={screen.id} to={`/screens/${screen.id}`}>
                <StatusDot status={screen.status} />
                <span className="ops-attention-list__name">
                  <strong>{screen.name}</strong>
                  <small>{screen.location || "No location set"}</small>
                </span>
                <span>{statusLabels[screen.status]}</span>
                <time>{formatRelative(screen.lastContactAt)}</time>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="ops-grid">
        <section
          className="ops-panel ops-fleet"
          aria-labelledby="fleet-heading"
        >
          <header>
            <div>
              <h3 id="fleet-heading">Player fleet</h3>
              <p>Connection, playback readiness, and installed version.</p>
            </div>
            <Link to="/screens">Manage screens</Link>
          </header>
          {screens.isLoading ? (
            <div className="ops-empty">Loading player status…</div>
          ) : screens.isError ? (
            <div className="ops-empty" role="alert">
              <CircleAlert size={20} aria-hidden="true" />
              <strong>Player status could not be loaded</strong>
              <span>
                Refresh the page or check the Tilecast server connection.
              </span>
            </div>
          ) : allScreens.length === 0 ? (
            <div className="ops-empty">
              <MonitorCheck size={20} aria-hidden="true" />
              <strong>No screens paired</strong>
              <Link to="/screens/pair">Pair the first screen</Link>
            </div>
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Player</th>
                    <th>Last contact</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allScreens.map((screen) => (
                    <tr key={screen.id}>
                      <td>
                        <Link to={`/screens/${screen.id}`}>{screen.name}</Link>
                      </td>
                      <td>
                        <span className="ops-inline-status">
                          <StatusDot status={screen.status} />{" "}
                          {statusLabels[screen.status]}
                        </span>
                      </td>
                      <td>{screen.location || "Not set"}</td>
                      <td>{screen.playerVersion || "Not reported"}</td>
                      <td>{formatRelative(screen.lastContactAt)}</td>
                      <td>
                        <Link
                          className="ops-row-link"
                          aria-label={`Open ${screen.name}`}
                          to={`/screens/${screen.id}`}
                        >
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="ops-side">
          <section className="ops-panel">
            <header>
              <div>
                <h3>Next schedule change</h3>
                <p>Next enabled playback transition.</p>
              </div>
            </header>
            {schedules.isError ? (
              <div className="ops-empty ops-empty--compact" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <strong>Schedules could not be loaded</strong>
              </div>
            ) : nextChange ? (
              <div className="ops-key-value">
                <strong>{nextChange.schedule.name}</strong>
                <span>{formatScheduleTime(nextChange.at)}</span>
                <small>
                  {nextChange.schedule.playlistName} on{" "}
                  {targetLabel(nextChange.schedule)}
                </small>
                <Link to={`/schedules/${nextChange.schedule.id}`}>
                  Open schedule <ChevronRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="ops-empty ops-empty--compact">
                <CalendarClock size={18} aria-hidden="true" />
                <strong>No upcoming change</strong>
                <span>
                  Fallback assignments continue until a schedule starts.
                </span>
              </div>
            )}
          </section>

          <section className="ops-panel">
            <header>
              <div>
                <h3>Player updates</h3>
                <p>Latest deployment result.</p>
              </div>
              <Link to="/settings/player-updates">Update center</Link>
            </header>
            {deployments.isError ? (
              <div className="ops-empty ops-empty--compact" role="alert">
                <CircleAlert size={18} aria-hidden="true" />
                <strong>Update status could not be loaded</strong>
              </div>
            ) : latestDeployment ? (
              <dl className="ops-deployment">
                <div>
                  <dt>Release</dt>
                  <dd>{latestDeployment.versionName}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{humanize(latestDeployment.status)}</dd>
                </div>
                <div>
                  <dt>Succeeded</dt>
                  <dd>
                    {latestDeployment.succeededCount}/
                    {latestDeployment.targetCount}
                  </dd>
                </div>
                <div>
                  <dt>Action needed</dt>
                  <dd>
                    {latestDeployment.failedCount +
                      latestDeployment.waitingForUserCount}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="ops-empty ops-empty--compact">
                <RefreshCw size={18} aria-hidden="true" />
                <strong>No deployments yet</strong>
                <span>
                  Published player releases appear in the update center.
                </span>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Summary({
  value,
  label,
  urgent = false,
}: {
  value: string;
  label: string;
  urgent?: boolean;
}) {
  return (
    <div
      className={
        urgent
          ? "ops-summary__item ops-summary__item--urgent"
          : "ops-summary__item"
      }
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function StatusDot({ status }: { status: ScreenStatus }) {
  return (
    <span
      className={`ops-status-dot ops-status-dot--${status}`}
      aria-hidden="true"
    />
  );
}

function formatRelative(value?: string) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function nextScheduleChange(schedules: Schedule[]) {
  const now = new Date();
  const candidates: { schedule: Schedule; at: Date }[] = [];
  for (const schedule of schedules) {
    if (schedule.type === "one_time" && schedule.oneTimeStart) {
      const at = new Date(schedule.oneTimeStart);
      if (at > now) candidates.push({ schedule, at });
      continue;
    }
    if (!schedule.dailyStart || schedule.daysOfWeek.length === 0) continue;
    const [hour = 0, minute = 0] = schedule.dailyStart.split(":").map(Number);
    for (let offset = 0; offset < 8; offset += 1) {
      const at = new Date(now);
      at.setDate(now.getDate() + offset);
      at.setHours(hour, minute, 0, 0);
      if (at > now && schedule.daysOfWeek.includes(at.getDay())) {
        candidates.push({ schedule, at });
        break;
      }
    }
  }
  return candidates.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
}

function targetLabel(schedule: Schedule) {
  if (schedule.targets.length === 0) return "no targets";
  if (schedule.targets.length === 1)
    return schedule.targets[0]?.name ?? "1 target";
  return `${schedule.targets.length} targets`;
}

function formatScheduleTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
