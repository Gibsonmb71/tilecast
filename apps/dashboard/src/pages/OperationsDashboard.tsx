import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ImagePlus,
  ListVideo,
  Monitor,
  MonitorCheck,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Upload,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type {
  EmergencyTakeover,
  PlaylistAssignment,
  Schedule,
  Screen,
} from "../api/types";
import "./OperationsDashboard.css";

const assetParams = new URLSearchParams({
  page: "1",
  pageSize: "100",
  sort: "updated_desc",
});

export function OperationsDashboard() {
  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 30_000,
  });
  const system = useQuery({
    queryKey: ["system-status"],
    queryFn: api.systemStatus,
    refetchInterval: 30_000,
  });
  const emergencies = useQuery({
    queryKey: ["emergencies"],
    queryFn: api.emergencies,
    refetchInterval: 15_000,
  });
  const schedules = useQuery({
    queryKey: ["schedules"],
    queryFn: () => api.schedules(),
  });
  const assets = useQuery({
    queryKey: ["assets", "dashboard"],
    queryFn: () => api.assets(assetParams),
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
  });

  const allScreens = screens.data?.items ?? [];
  const assignmentQueries = useQueries({
    queries: allScreens.slice(0, 8).map((screen) => ({
      queryKey: ["playlist-assignment", screen.id],
      queryFn: () => api.playlistAssignment(screen.id),
      refetchInterval: 30_000,
    })),
  });
  const assignments = assignmentQueries
    .map((query) => query.data)
    .filter((value): value is PlaylistAssignment => Boolean(value));

  const activeEmergency = (emergencies.data?.items ?? []).find(
    (item) => item.status === "active" || item.status === "preparing",
  );
  const online = allScreens.filter(
    (screen) => screen.status === "online",
  ).length;
  const attention = buildAttention(allScreens, assignments);
  const processing = (assets.data?.items ?? []).filter((asset) =>
    ["uploading", "uploaded", "queued", "inspecting", "processing"].includes(
      asset.processingStatus,
    ),
  ).length;
  const failedAssets = (assets.data?.items ?? []).filter(
    (asset) => asset.processingStatus === "failed",
  ).length;
  const updateIssues = (deployments.data?.items ?? []).reduce(
    (count, deployment) =>
      count + deployment.failedCount + deployment.waitingForUserCount,
    0,
  );
  const upcoming = nextScheduleChanges(schedules.data?.items ?? []).slice(0, 5);
  const loading = screens.isLoading || system.isLoading;

  return (
    <div className="ops-dashboard">
      <section className="ops-hero">
        <div>
          <p className="ops-eyebrow">Operations overview</p>
          <h2>Everything that needs your attention, in one place.</h2>
          <p>
            Monitor display health, playback, schedules, media processing, and
            player operations across your Tilecast installation.
          </p>
        </div>
        <div className="ops-quick-actions" aria-label="Quick actions">
          <Link className="ops-action ops-action--primary" to="/screens/pair">
            <MonitorCheck size={17} /> Pair screen
          </Link>
          <Link className="ops-action" to="/content">
            <Upload size={17} /> Upload content
          </Link>
          <Link className="ops-action" to="/schedules/new">
            <CalendarClock size={17} /> New schedule
          </Link>
        </div>
      </section>

      <section className="ops-metrics" aria-label="Installation summary">
        <MetricCard
          icon={<Monitor size={20} />}
          label="Screens online"
          value={loading ? "—" : `${online} / ${allScreens.length}`}
          detail={
            allScreens.length === 0
              ? "No screens paired"
              : online === allScreens.length
                ? "All paired screens are online"
                : `${allScreens.length - online} not currently online`
          }
          tone={
            online === allScreens.length && allScreens.length > 0
              ? "good"
              : "neutral"
          }
          to="/screens"
        />
        <MetricCard
          icon={<Radio size={20} />}
          label="Active playback"
          value={String(
            assignments.filter(
              (assignment) =>
                assignment.selectionSource &&
                assignment.selectionSource !== "none",
            ).length,
          )}
          detail={`${assignments.filter((item) => item.selectionSource === "schedule").length} scheduled · ${assignments.filter((item) => item.selectionSource === "direct_fallback").length} fallback`}
          tone="neutral"
          to="/screens"
        />
        <MetricCard
          icon={<ShieldAlert size={20} />}
          label="Emergency takeover"
          value={activeEmergency ? "Active" : "Clear"}
          detail={
            activeEmergency
              ? `${activeEmergency.name} · ${activeEmergency.affectedCount} screens`
              : "No emergency takeover is active"
          }
          tone={activeEmergency ? "danger" : "good"}
          to="/screens"
        />
        <MetricCard
          icon={<CheckCircle2 size={20} />}
          label="System health"
          value={
            system.data?.database.status === "ok" ? "Healthy" : "Check system"
          }
          detail={
            system.data
              ? `${system.data.connectedScreens} connected · ${system.data.activeProcessingJobs} processing`
              : "Checking services"
          }
          tone={system.data?.database.status === "ok" ? "good" : "warning"}
          to="/settings/system"
        />
      </section>

      <section className="ops-primary-grid">
        <Panel
          title="Needs attention"
          description="Only screens with an actionable problem appear here."
          icon={<CircleAlert size={18} />}
          action={
            <Link to="/screens">
              View all screens <ArrowRight size={15} />
            </Link>
          }
        >
          {screens.isLoading ? (
            <LoadingRows />
          ) : attention.length > 0 ? (
            <div className="ops-attention-list">
              {attention.slice(0, 6).map((item) => (
                <Link
                  key={`${item.screen.id}-${item.label}`}
                  to={`/screens/${item.screen.id}`}
                >
                  <span className={`ops-severity ops-severity--${item.tone}`}>
                    {item.icon}
                  </span>
                  <span className="ops-attention-copy">
                    <strong>{item.screen.name}</strong>
                    <small>{item.screen.location || "No location set"}</small>
                  </span>
                  <span className="ops-attention-problem">
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<CheckCircle2 size={24} />}
              title="Nothing needs attention"
              detail={
                allScreens.length === 0
                  ? "Pair your first display to begin monitoring it here."
                  : "All paired screens are reporting normally."
              }
              action={
                allScreens.length === 0 ? (
                  <Link to="/screens/pair">Pair a screen</Link>
                ) : undefined
              }
            />
          )}
        </Panel>

        <Panel
          title="Upcoming schedule changes"
          description="The next enabled playback windows across your installation."
          icon={<Clock3 size={18} />}
          action={
            <Link to="/schedules">
              Open schedules <ArrowRight size={15} />
            </Link>
          }
        >
          {schedules.isLoading ? (
            <LoadingRows />
          ) : upcoming.length > 0 ? (
            <div className="ops-timeline">
              {upcoming.map(({ schedule, at, label }) => (
                <Link
                  key={`${schedule.id}-${at.toISOString()}`}
                  to={`/schedules/${schedule.id}`}
                >
                  <time dateTime={at.toISOString()}>
                    {formatScheduleTime(at)}
                  </time>
                  <span className="ops-timeline-marker" />
                  <span>
                    <strong>{schedule.playlistName}</strong>
                    <small>
                      {schedule.name} · {targetLabel(schedule)} · {label}
                    </small>
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={<CalendarClock size={24} />}
              title="No upcoming schedules"
              detail="Create a weekly or one-time schedule to plan the next playback change."
              action={<Link to="/schedules/new">Create schedule</Link>}
            />
          )}
        </Panel>
      </section>

      <Panel
        title="Now playing"
        description="Current selection and synchronization state for recently active screens."
        icon={<ListVideo size={18} />}
        action={
          <Link to="/screens">
            Open screen monitor <ArrowRight size={15} />
          </Link>
        }
      >
        {screens.isLoading ||
        assignmentQueries.some((query) => query.isLoading) ? (
          <div className="ops-playing-grid">
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </div>
        ) : allScreens.length > 0 ? (
          <div className="ops-playing-grid">
            {allScreens.slice(0, 8).map((screen, index) => (
              <NowPlayingCard
                key={screen.id}
                screen={screen}
                assignment={assignmentQueries[index]?.data}
              />
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={<Monitor size={24} />}
            title="No screens paired"
            detail="Paired screens and their current playback will appear here."
            action={<Link to="/screens/pair">Pair a screen</Link>}
          />
        )}
      </Panel>

      <section className="ops-secondary-grid">
        <Panel
          title="Content pipeline"
          description="Uploads and media jobs that may affect playback readiness."
          icon={<ImagePlus size={18} />}
          action={
            <Link to="/content">
              Open content <ArrowRight size={15} />
            </Link>
          }
        >
          <div className="ops-compact-stats">
            <CompactStat
              icon={<RefreshCw size={17} />}
              value={processing}
              label="Processing"
              detail="Uploads, inspection, and transcoding"
            />
            <CompactStat
              icon={<AlertTriangle size={17} />}
              value={failedAssets}
              label="Failed"
              detail="Assets requiring review or retry"
              warning={failedAssets > 0}
            />
          </div>
        </Panel>
        <Panel
          title="Player operations"
          description="Commands, update approvals, and failed deployments."
          icon={<Wrench size={18} />}
          action={
            <Link to="/settings/player-updates">
              Player updates <ArrowRight size={15} />
            </Link>
          }
        >
          <div className="ops-compact-stats">
            <CompactStat
              icon={<Zap size={17} />}
              value={system.data?.pendingCommands ?? 0}
              label="Pending commands"
              detail="Queued for connected or returning players"
            />
            <CompactStat
              icon={<AlertTriangle size={17} />}
              value={updateIssues}
              label="Update actions"
              detail="Failures or screens waiting for approval"
              warning={updateIssues > 0}
            />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "good" | "warning" | "danger" | "neutral";
  to: string;
}) {
  return (
    <Link className={`ops-metric ops-metric--${tone}`} to={to}>
      <span className="ops-metric-icon">{icon}</span>
      <span className="ops-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <ArrowRight className="ops-metric-arrow" size={16} />
    </Link>
  );
}

function Panel({
  title,
  description,
  icon,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="ops-panel">
      <header className="ops-panel-header">
        <div className="ops-panel-heading">
          <span>{icon}</span>
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
        </div>
        {action && <div className="ops-panel-action">{action}</div>}
      </header>
      <div className="ops-panel-body">{children}</div>
    </section>
  );
}

function NowPlayingCard({
  screen,
  assignment,
}: {
  screen: Screen;
  assignment?: PlaylistAssignment;
}) {
  const source = assignment?.selectionSource;
  const sourceLabel =
    source === "emergency"
      ? "Emergency"
      : source === "schedule"
        ? "Schedule"
        : source === "direct_fallback"
          ? "Fallback"
          : "No content";
  const title = assignment?.currentPlaylistId
    ? (assignment.relevantSchedules.find(
        (schedule) => schedule.id === assignment.currentScheduleId,
      )?.playlistName ??
      assignment.playlistName ??
      "Assigned playlist")
    : (assignment?.playlistName ?? "No playlist assigned");
  return (
    <Link className="ops-playing-card" to={`/screens/${screen.id}`}>
      <div className="ops-playing-visual">
        <Monitor size={28} />
        <span className={`ops-live-dot ops-live-dot--${screen.status}`} />
      </div>
      <div className="ops-playing-copy">
        <div>
          <strong>{screen.name}</strong>
          <small>
            {screen.location ||
              `${screen.deviceManufacturer} ${screen.deviceModel}`}
          </small>
        </div>
        <span
          className={`ops-source-pill ops-source-pill--${source ?? "none"}`}
        >
          {sourceLabel}
        </span>
      </div>
      <div className="ops-playing-title">
        <span>Playing</span>
        <strong>{title}</strong>
      </div>
      <div className="ops-playing-footer">
        <span>{syncLabel(assignment)}</span>
        <ArrowRight size={15} />
      </div>
    </Link>
  );
}

function EmptyPanel({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ops-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && <div>{action}</div>}
    </div>
  );
}

function CompactStat({
  icon,
  value,
  label,
  detail,
  warning = false,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <div
      className={
        warning
          ? "ops-compact-stat ops-compact-stat--warning"
          : "ops-compact-stat"
      }
    >
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <b>{label}</b>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="ops-loading-rows">
      <i />
      <i />
      <i />
    </div>
  );
}
function LoadingCard() {
  return (
    <div className="ops-loading-card">
      <i />
      <i />
      <i />
    </div>
  );
}

function buildAttention(screens: Screen[], assignments: PlaylistAssignment[]) {
  const assignmentByScreen = new Map(
    assignments.map((item) => [item.screenId, item]),
  );
  return screens.flatMap((screen) => {
    const assignment = assignmentByScreen.get(screen.id);
    if (screen.status === "offline")
      return [
        {
          screen,
          label: "Offline",
          detail: lastSeen(screen),
          tone: "danger",
          icon: <WifiOff size={17} />,
        },
      ];
    if (screen.status === "stale")
      return [
        {
          screen,
          label: "Connection stale",
          detail: lastSeen(screen),
          tone: "warning",
          icon: <AlertTriangle size={17} />,
        },
      ];
    if (screen.status === "revoked")
      return [
        {
          screen,
          label: "Pairing revoked",
          detail: "Player credential is inactive",
          tone: "danger",
          icon: <ShieldAlert size={17} />,
        },
      ];
    if (assignment?.lastSynchronizationError || assignment?.lastPlaybackError)
      return [
        {
          screen,
          label: "Playback error",
          detail:
            assignment.lastPlaybackError ??
            assignment.lastSynchronizationError ??
            "Open for details",
          tone: "danger",
          icon: <CircleAlert size={17} />,
        },
      ];
    if (assignment?.synchronizationStatus === "out_of_date")
      return [
        {
          screen,
          label: "Content out of date",
          detail: "Player has not activated the latest manifest",
          tone: "warning",
          icon: <RefreshCw size={17} />,
        },
      ];
    if (assignment?.configurationError)
      return [
        {
          screen,
          label: "Configuration error",
          detail: assignment.configurationError,
          tone: "warning",
          icon: <Wrench size={17} />,
        },
      ];
    if (!assignment?.playlistId && assignment?.selectionSource === "none")
      return [
        {
          screen,
          label: "No content assigned",
          detail: "Assign a fallback playlist or schedule",
          tone: "neutral",
          icon: <Sparkles size={17} />,
        },
      ];
    return [];
  });
}

function nextScheduleChanges(schedules: Schedule[]) {
  const now = new Date();
  const changes: { schedule: Schedule; at: Date; label: string }[] = [];
  for (const schedule of schedules.filter((item) => item.enabled)) {
    if (schedule.type === "one_time" && schedule.oneTimeStart) {
      const at = new Date(schedule.oneTimeStart);
      if (at > now) changes.push({ schedule, at, label: "starts" });
      continue;
    }
    if (!schedule.dailyStart || schedule.daysOfWeek.length === 0) continue;
    const [hour = 0, minute = 0] = schedule.dailyStart.split(":").map(Number);
    for (let offset = 0; offset < 8; offset += 1) {
      const at = new Date(now);
      at.setDate(now.getDate() + offset);
      at.setHours(hour, minute, 0, 0);
      if (at <= now || !schedule.daysOfWeek.includes(at.getDay())) continue;
      changes.push({ schedule, at, label: "starts" });
      break;
    }
  }
  return changes.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function targetLabel(schedule: Schedule) {
  const count = schedule.targets.length;
  if (count === 0) return "No targets";
  if (count === 1) return schedule.targets[0]?.name ?? "1 target";
  return `${count} targets`;
}
function formatScheduleTime(value: Date) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = value.toDateString() === today.toDateString();
  const nextDay = value.toDateString() === tomorrow.toDateString();
  const day = sameDay
    ? "Today"
    : nextDay
      ? "Tomorrow"
      : value.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
  return `${day}, ${value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
function lastSeen(screen: Screen) {
  if (!screen.lastContactAt) return "Never contacted";
  const minutes = Math.max(
    1,
    Math.round(
      (Date.now() - new Date(screen.lastContactAt).getTime()) / 60_000,
    ),
  );
  return minutes < 60
    ? `Last seen ${minutes} min ago`
    : `Last seen ${Math.round(minutes / 60)} hr ago`;
}
function syncLabel(assignment?: PlaylistAssignment) {
  if (!assignment) return "Loading playback state";
  if (assignment.synchronizationStatus === "current")
    return "Content synchronized";
  if (assignment.synchronizationStatus === "preparing")
    return "Preparing content";
  if (assignment.synchronizationStatus === "out_of_date")
    return "Content out of date";
  return "Awaiting player report";
}
