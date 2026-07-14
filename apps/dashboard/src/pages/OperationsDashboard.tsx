import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Monitor,
  MonitorCheck,
  Plus,
  RefreshCw,
  Upload,
  WifiOff,
  Wrench,
} from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type { PlaylistAssignment, Schedule, Screen } from "../api/types";
import "./OperationsDashboard.css";

export function OperationsDashboard() {
  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 30_000,
  });
  const schedules = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules(),
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
  });

  const allScreens = screens.data?.items ?? [];
  const assignmentQueries = useQueries({
    queries: allScreens.map((screen) => ({
      queryKey: ["playlist-assignment", screen.id],
      queryFn: () => api.playlistAssignment(screen.id),
      refetchInterval: 30_000,
    })),
  });
  const assignments = assignmentQueries
    .map((query) => query.data)
    .filter((value): value is PlaylistAssignment => Boolean(value));

  const onlineCount = allScreens.filter(
    (screen) => screen.status === "online",
  ).length;
  const issueScreens = allScreens.filter(
    (screen) => screen.status !== "online",
  );
  const primaryIssue = issueScreens[0];
  const additionalIssues = issueScreens.slice(1);
  const primaryAssignment = primaryIssue
    ? assignments.find((item) => item.screenId === primaryIssue.id)
    : assignments[0];
  const enabledSchedules = (schedules.data?.items ?? []).filter(
    (item) => item.enabled,
  );
  const nextChange = nextScheduleChange(enabledSchedules);
  const lastUpdated = newestContact(allScreens);
  const verifiedCount = onlineCount;
  const verifiedPercent =
    allScreens.length === 0
      ? 0
      : Math.round((verifiedCount / allScreens.length) * 100);
  const pendingUpdateActions = (deployments.data?.items ?? []).reduce(
    (count, deployment) =>
      count + deployment.waitingForUserCount + deployment.failedCount,
    0,
  );
  const outageDuration = primaryIssue
    ? formatDurationSince(primaryIssue.lastContactAt)
    : "None";
  const scheduleCoverage = enabledSchedules.length > 0 ? 100 : 0;

  return (
    <div className="ops-console">
      <header className="ops-console__header">
        <div>
          <h2>Overview</h2>
          <div className="ops-console__meta">
            <span>
              {allScreens.length} screen{allScreens.length === 1 ? "" : "s"}
            </span>
            <span aria-hidden="true">•</span>
            <strong>
              {issueScreens.length} issue{issueScreens.length === 1 ? "" : "s"}{" "}
              requiring attention
            </strong>
            <span aria-hidden="true">•</span>
            <span>Last updated {formatRelative(lastUpdated)}</span>
          </div>
        </div>
        <div className="ops-console__actions" aria-label="Quick actions">
          <Link className="ops-button ops-button--primary" to="/screens/pair">
            <MonitorCheck size={16} /> Pair screen
          </Link>
          <details className="ops-create-menu">
            <summary className="ops-button">
              <Plus size={16} /> Create
            </summary>
            <div className="ops-create-menu__popover">
              <Link to="/content">
                <Upload size={16} /> Upload content
              </Link>
              <Link to="/schedules/new">
                <CalendarClock size={16} /> Create schedule
              </Link>
            </div>
          </details>
        </div>
      </header>

      {primaryIssue ? (
        <section className="ops-alert" aria-labelledby="primary-alert-title">
          <div className="ops-alert__icon">
            <WifiOff size={20} />
          </div>
          <div className="ops-alert__body">
            <div className="ops-alert__heading">
              <div>
                <span className="ops-status ops-status--danger">Offline</span>
                <h3 id="primary-alert-title">{primaryIssue.name} is offline</h3>
              </div>
              <OverflowMenu>
                <Link to={`/screens/${primaryIssue.id}`}>Open details</Link>
                <Link to="/screens">View all screens</Link>
              </OverflowMenu>
            </div>
            <p>
              Last seen {formatRelative(primaryIssue.lastContactAt)} · Playback
              status cannot currently be verified
            </p>
            <div className="ops-alert__reported">
              <span>Last reported playback</span>
              <strong>{playbackName(primaryAssignment)}</strong>
              <small>{playbackDetail(primaryAssignment)}</small>
            </div>
          </div>
          <div className="ops-alert__actions">
            <Link
              className="ops-button ops-button--warning"
              to={`/screens/${primaryIssue.id}?tab=reliability`}
            >
              Troubleshoot
            </Link>
            <Link className="ops-button" to={`/screens/${primaryIssue.id}`}>
              View screen
            </Link>
          </div>
        </section>
      ) : allScreens.length > 0 ? (
        <section className="ops-alert ops-alert--healthy">
          <div className="ops-alert__icon">
            <MonitorCheck size={20} />
          </div>
          <div className="ops-alert__body">
            <span className="ops-status ops-status--healthy">Healthy</span>
            <h3>All screens are online</h3>
            <p>Current player status is being reported normally.</p>
          </div>
        </section>
      ) : null}

      <section className="ops-metrics-strip" aria-label="Operational metrics">
        <Metric
          value={`${onlineCount} / ${allScreens.length}`}
          label="Screens online"
          detail={`${issueScreens.length} screen${issueScreens.length === 1 ? "" : "s"} offline`}
        />
        <Metric
          value={`${verifiedPercent}%`}
          label="Playback verified"
          detail={`${verifiedCount} of ${allScreens.length} confirmed`}
        />
        <Metric
          value="Not tracked"
          label="7-day uptime"
          detail="Historical telemetry unavailable"
          muted
        />
        <Metric
          value={String(pendingUpdateActions)}
          label="Player updates pending"
          detail={
            pendingUpdateActions === 1
              ? "1 update action pending"
              : `${pendingUpdateActions} update actions pending`
          }
        />
      </section>

      <section className="ops-dashboard-grid">
        <div className="ops-dashboard-grid__main">
          <section className="ops-card ops-now-playing">
            <div className="ops-card__eyebrow">
              <Monitor size={17} />
              <span>Now playing</span>
            </div>
            <div className="ops-now-playing__content">
              <div>
                <h3>{playbackName(primaryAssignment)}</h3>
                <span className="ops-status ops-status--neutral">
                  {primaryIssue
                    ? "Playback unverified"
                    : primaryAssignment
                      ? "Live"
                      : "Status unavailable"}
                </span>
              </div>
              <p>
                {primaryIssue
                  ? "The most recent player report indicated fallback playback."
                  : primaryAssignment
                    ? "Current playback is based on the latest player report."
                    : "No playback report is available yet."}
              </p>
              <DetailStats
                items={[
                  [
                    "Verified screens",
                    `${verifiedCount} / ${allScreens.length}`,
                  ],
                  ["Last confirmed", formatRelative(lastUpdated)],
                  ["Interruptions", "Not tracked"],
                ]}
              />
              <Link
                className="ops-inline-action"
                to={primaryIssue ? `/screens/${primaryIssue.id}` : "/screens"}
              >
                View playback details <ChevronRight size={14} />
              </Link>
            </div>
          </section>

          {additionalIssues.length > 0 ? (
            <section className="ops-card ops-attention-card">
              <div className="ops-card__header">
                <div>
                  <h3>Needs attention</h3>
                  <p>Additional issues not covered by the primary alert.</p>
                </div>
                <Link to="/screens">View all</Link>
              </div>
              <div className="ops-issue-list">
                {additionalIssues.map((screen) => (
                  <Link key={screen.id} to={`/screens/${screen.id}`}>
                    <span className="ops-issue-list__icon">
                      <CircleAlert size={17} />
                    </span>
                    <span>
                      <strong>{screen.name}</strong>
                      <small>
                        {statusLabel(screen)} · Last seen{" "}
                        {formatRelative(screen.lastContactAt)}
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section className="ops-card ops-upcoming">
            <div className="ops-card__header">
              <div>
                <h3>Upcoming changes</h3>
                <p>Chronological changes expected to affect screens.</p>
              </div>
            </div>
            {nextChange ? (
              <div className="ops-change-list">
                <Link to={`/schedules/${nextChange.schedule.id}`}>
                  <time>{formatScheduleTime(nextChange.at)}</time>
                  <span>
                    <strong>Playback schedule</strong>
                    <small>
                      {nextChange.schedule.name} ·{" "}
                      {targetLabel(nextChange.schedule)}
                    </small>
                  </span>
                  <span className="ops-status ops-status--neutral">
                    Scheduled
                  </span>
                </Link>
              </div>
            ) : (
              <div className="ops-empty-compact">
                <RefreshCw size={18} />
                <strong>No upcoming operational changes</strong>
                <span>
                  There are no schedule changes, maintenance windows, or update
                  deployments with a future time.
                </span>
              </div>
            )}
          </section>
        </div>

        <aside className="ops-dashboard-grid__rail">
          <section className="ops-card ops-compact-card">
            <div className="ops-card__eyebrow">
              <MonitorCheck size={17} />
              <span>Fleet health</span>
            </div>
            <strong className="ops-compact-card__value">
              {onlineCount} of {allScreens.length} screens online
            </strong>
            <span
              className={`ops-status ${
                allScreens.length === 0
                  ? "ops-status--neutral"
                  : onlineCount === allScreens.length
                    ? "ops-status--healthy"
                    : "ops-status--danger"
              }`}
            >
              {allScreens.length === 0
                ? "Setup incomplete"
                : onlineCount === allScreens.length
                  ? "Healthy"
                  : "Action required"}
            </span>
            <DetailStats
              stacked
              items={[
                ["Current outage", outageDuration],
                ["7-day uptime", "Not tracked"],
                ["Reconnects", "Not tracked"],
              ]}
            />
            <Link className="ops-inline-action" to="/screens">
              Open screens <ChevronRight size={14} />
            </Link>
          </section>

          <section className="ops-card ops-compact-card">
            <div className="ops-card__eyebrow">
              <CalendarClock size={17} />
              <span>Next schedule</span>
            </div>
            <strong className="ops-compact-card__value">
              {nextChange ? nextChange.schedule.name : "No scheduled changes"}
            </strong>
            <DetailStats
              stacked
              items={[
                ["24-hour schedule coverage", `${scheduleCoverage}%`],
                [
                  "Screens without a schedule",
                  String(enabledSchedules.length > 0 ? 0 : allScreens.length),
                ],
                ["Upcoming playback changes", String(nextChange ? 1 : 0)],
              ]}
            />
            {nextChange ? (
              <>
                <span className="ops-status ops-status--neutral">
                  {formatScheduleTime(nextChange.at)}
                </span>
                <p>
                  {nextChange.schedule.playlistName} will begin on{" "}
                  {targetLabel(nextChange.schedule)}.
                </p>
                <Link
                  className="ops-inline-action"
                  to={`/schedules/${nextChange.schedule.id}`}
                >
                  View schedule <ChevronRight size={14} />
                </Link>
              </>
            ) : (
              <>
                <p>
                  Fallback content will continue until a schedule is created.
                </p>
                <Link className="ops-inline-action" to="/schedules/new">
                  Create schedule <ChevronRight size={14} />
                </Link>
              </>
            )}
          </section>

          <section className="ops-secondary-cards">
            <section className="ops-card ops-maintenance-card">
              <div className="ops-card__header">
                <div>
                  <h3>Player maintenance</h3>
                  <p>Planned work that may briefly affect screens.</p>
                </div>
                <OverflowMenu>
                  <Link to="/settings/system">Open maintenance tools</Link>
                </OverflowMenu>
              </div>
              <div className="ops-empty-compact">
                <Wrench size={18} />
                <strong>No maintenance windows scheduled</strong>
                <span>
                  Tilecast does not currently store planned maintenance windows.
                </span>
                <Link className="ops-inline-action" to="/settings/system">
                  Open maintenance tools <ChevronRight size={14} />
                </Link>
              </div>
            </section>

            <section
              className={`ops-card ops-update-card ${pendingUpdateActions > 0 ? "ops-update-card--warning" : ""}`}
            >
              <div className="ops-card__header">
                <div>
                  <h3>Player updates</h3>
                  <p>Releases awaiting deployment or operator approval.</p>
                </div>
                <OverflowMenu>
                  <Link to="/settings/player-updates">Open update center</Link>
                </OverflowMenu>
              </div>
              <strong className="ops-update-card__title">
                {pendingUpdateActions} player update action
                {pendingUpdateActions === 1 ? "" : "s"} pending
              </strong>
              <span
                className={`ops-status ${pendingUpdateActions > 0 ? "ops-status--warning" : "ops-status--healthy"}`}
              >
                {pendingUpdateActions > 0 ? "Not scheduled" : "Up to date"}
              </span>
              <DetailStats
                stacked
                items={[
                  ["Eligible screens", String(allScreens.length)],
                  ["Scheduled screens", "0"],
                  [
                    "Restart required",
                    pendingUpdateActions > 0 ? "May be required" : "No",
                  ],
                ]}
              />
              <div className="ops-card-actions">
                <Link
                  className="ops-button ops-button--primary"
                  to="/settings/player-updates"
                >
                  Schedule update
                </Link>
                <Link
                  className="ops-inline-action"
                  to="/settings/player-updates"
                >
                  View releases <ChevronRight size={14} />
                </Link>
              </div>
            </section>
          </section>
        </aside>
      </section>
    </div>
  );
}

function Metric({
  value,
  label,
  detail,
  muted = false,
}: {
  value: string;
  label: string;
  detail: string;
  muted?: boolean;
}) {
  return (
    <div className={`ops-metric-item ${muted ? "ops-metric-item--muted" : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      <small>{detail}</small>
    </div>
  );
}

function DetailStats({
  items,
  stacked = false,
}: {
  items: [string, string][];
  stacked?: boolean;
}) {
  return (
    <dl
      className={`ops-detail-stats ${stacked ? "ops-detail-stats--stacked" : ""}`}
    >
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OverflowMenu({ children }: { children: React.ReactNode }) {
  return (
    <details className="ops-overflow">
      <summary aria-label="More actions">
        <Ellipsis size={18} />
      </summary>
      <div>{children}</div>
    </details>
  );
}

function playbackName(assignment?: PlaylistAssignment) {
  if (!assignment) return "Status unavailable";
  if (assignment.selectionSource === "direct_fallback")
    return assignment.playlistName ?? "Fallback content";
  if (assignment.selectionSource === "schedule")
    return assignment.playlistName ?? "Scheduled content";
  if (assignment.selectionSource === "emergency")
    return assignment.playlistName ?? "Emergency content";
  return "No content reported";
}

function playbackDetail(assignment?: PlaylistAssignment) {
  if (!assignment) return "No player report is available";
  if (assignment.selectionSource === "direct_fallback")
    return "Fallback content · reported before disconnect";
  if (assignment.selectionSource === "schedule")
    return "Scheduled content · reported before disconnect";
  return "Reported before disconnect";
}

function newestContact(screens: Screen[]) {
  return screens.reduce<string | undefined>((current, screen) => {
    if (!screen.lastContactAt) return current;
    if (!current || new Date(screen.lastContactAt) > new Date(current))
      return screen.lastContactAt;
    return current;
  }, undefined);
}

function statusLabel(screen: Screen) {
  if (screen.status === "offline") return "Offline";
  if (screen.status === "stale") return "Stale connection";
  if (screen.status === "recent") return "Connection interrupted";
  if (screen.status === "disabled") return "Playback disabled";
  if (screen.status === "revoked") return "Pairing revoked";
  return "Action required";
}

function formatDurationSince(value?: string) {
  if (!value) return "Unavailable";
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRelative(value?: string) {
  if (!value) return "unavailable";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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
      if (at <= now || !schedule.daysOfWeek.includes(at.getDay())) continue;
      candidates.push({ schedule, at });
      break;
    }
  }
  return candidates.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
}

function targetLabel(schedule: Schedule) {
  const count = schedule.targets.length;
  if (count === 0) return "no targets";
  if (count === 1) return schedule.targets[0]?.name ?? "1 target";
  return `${count} targets`;
}

function formatScheduleTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
