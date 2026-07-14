import {
  CalendarClock,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  Monitor,
  MonitorCheck,
  PlayCircle,
  Upload,
  WifiOff,
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
  const primaryAssignment = primaryIssue
    ? assignments.find((item) => item.screenId === primaryIssue.id)
    : undefined;
  const nextChange = nextScheduleChange(schedules.data?.items ?? []);
  const lastUpdated = newestContact(allScreens);

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
          <Link className="ops-button" to="/content">
            <Upload size={16} /> Upload content
          </Link>
          <Link className="ops-button" to="/schedules/new">
            <CalendarClock size={16} /> Create schedule
          </Link>
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
              <details className="ops-overflow">
                <summary aria-label="More actions">
                  <Ellipsis size={18} />
                </summary>
                <div>
                  <Link to={`/screens/${primaryIssue.id}`}>Open details</Link>
                  <Link to="/screens">View all screens</Link>
                </div>
              </details>
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

      <section className="ops-summary" aria-label="Operational summary">
        <SummarySection
          icon={<Monitor size={18} />}
          title="Fleet health"
          value={`${onlineCount} of ${allScreens.length} screens online`}
          state={
            allScreens.length === 0
              ? "Setup incomplete"
              : onlineCount === allScreens.length
                ? "Healthy"
                : "Action required"
          }
          tone={
            allScreens.length > 0 && onlineCount !== allScreens.length
              ? "danger"
              : "neutral"
          }
          detail={
            allScreens.length === 0
              ? "Pair a screen to begin monitoring fleet health."
              : `${issueScreens.length} screen${issueScreens.length === 1 ? "" : "s"} currently need attention.`
          }
          to="/screens"
        />
        <SummarySection
          icon={<PlayCircle size={18} />}
          title="Now playing"
          value={playbackName(primaryAssignment)}
          state={
            primaryIssue
              ? "Status unverified"
              : assignments.length > 0
                ? "Live"
                : "Status unavailable"
          }
          tone="neutral"
          detail={
            primaryIssue
              ? "Fallback content was last reported playing, but current playback cannot be confirmed while the player is offline."
              : "Current playback is based on the latest player report."
          }
          to={primaryIssue ? `/screens/${primaryIssue.id}` : "/screens"}
        />
        <SummarySection
          icon={<CalendarClock size={18} />}
          title="Next schedule change"
          value={
            nextChange
              ? nextChange.schedule.name
              : "No upcoming scheduled changes"
          }
          state={nextChange ? formatScheduleTime(nextChange.at) : "No schedule"}
          tone="neutral"
          detail={
            nextChange
              ? `${nextChange.schedule.playlistName} will begin on ${targetLabel(nextChange.schedule)}.`
              : "Fallback content will continue until a schedule is created."
          }
          to={
            nextChange
              ? `/schedules/${nextChange.schedule.id}`
              : "/schedules/new"
          }
          actionLabel={nextChange ? "View schedule" : "Create schedule"}
        />
      </section>

      <section className="ops-detail-grid">
        <section className="ops-list-panel">
          <header>
            <div>
              <h3>Needs attention</h3>
              <p>Actionable exceptions are listed before healthy screens.</p>
            </div>
            <Link to="/screens">View all</Link>
          </header>
          {issueScreens.length > 0 ? (
            <div className="ops-issue-list">
              {issueScreens.map((screen) => (
                <Link key={screen.id} to={`/screens/${screen.id}`}>
                  <span className="ops-issue-list__icon">
                    <CircleAlert size={17} />
                  </span>
                  <span>
                    <strong>{screen.name}</strong>
                    <small>{screen.location || "No location set"}</small>
                  </span>
                  <span>
                    <strong>{statusLabel(screen)}</strong>
                    <small>
                      Last seen {formatRelative(screen.lastContactAt)}
                    </small>
                  </span>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="ops-empty">
              <MonitorCheck size={20} />
              <div>
                <strong>No active screen issues</strong>
                <span>All paired screens are reporting normally.</span>
              </div>
            </div>
          )}
        </section>

        <section className="ops-list-panel">
          <header>
            <div>
              <h3>Schedule</h3>
              <p>What will change next.</p>
            </div>
            <Link to="/schedules">Open schedules</Link>
          </header>
          {nextChange ? (
            <Link
              className="ops-schedule-row"
              to={`/schedules/${nextChange.schedule.id}`}
            >
              <span className="ops-schedule-row__time">
                {formatScheduleTime(nextChange.at)}
              </span>
              <span>
                <strong>{nextChange.schedule.playlistName}</strong>
                <small>
                  {nextChange.schedule.name} ·{" "}
                  {targetLabel(nextChange.schedule)}
                </small>
              </span>
              <ChevronRight size={16} />
            </Link>
          ) : (
            <div className="ops-empty ops-empty--actionable">
              <CalendarClock size={20} />
              <div>
                <strong>No scheduled changes</strong>
                <span>
                  Fallback content will continue until a schedule is created.
                </span>
              </div>
              <Link to="/schedules/new">Create schedule</Link>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function SummarySection({
  icon,
  title,
  value,
  state,
  tone,
  detail,
  to,
  actionLabel = "Open",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  state: string;
  tone: "danger" | "neutral";
  detail: string;
  to: string;
  actionLabel?: string;
}) {
  return (
    <Link className={`ops-summary__item ops-summary__item--${tone}`} to={to}>
      <span className="ops-summary__icon">{icon}</span>
      <span className="ops-summary__content">
        <span className="ops-summary__label">{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </span>
      <span className="ops-summary__side">
        <span
          className={`ops-status ${tone === "danger" ? "ops-status--danger" : "ops-status--neutral"}`}
        >
          {state}
        </span>
        <span className="ops-summary__link">
          {actionLabel} <ChevronRight size={14} />
        </span>
      </span>
    </Link>
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
  const latest = screens.reduce<string | undefined>((current, screen) => {
    if (!screen.lastContactAt) return current;
    if (!current || new Date(screen.lastContactAt) > new Date(current))
      return screen.lastContactAt;
    return current;
  }, undefined);
  return latest;
}

function statusLabel(screen: Screen) {
  if (screen.status === "offline") return "Offline";
  if (screen.status === "stale") return "Stale connection";
  if (screen.status === "recent") return "Connection interrupted";
  if (screen.status === "disabled") return "Playback disabled";
  if (screen.status === "revoked") return "Pairing revoked";
  return "Action required";
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
  for (const schedule of schedules.filter((item) => item.enabled)) {
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
