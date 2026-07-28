import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ToggleGroup } from "./ui";
import {
  activityRequest,
  EmptyState,
  ErrorNotice,
  formatDuration,
  formatWhen,
  humanize,
  Loading,
  ResourceLink,
} from "../pages/ActivityShared";
import { buildActivityLink } from "../pages/activityLinks";

type TimelineEntry = {
  id: string;
  timestamp: string;
  domain: string;
  kind: string;
  severity: string;
  title: string;
  description?: string;
  endedAt?: string;
  durationMs?: number;
  result?: string;
  linkType?: string;
  linkId?: string;
};

type ScreenTimeline = {
  range: { from: string; to: string };
  status: {
    currentPresentation?: string;
    currentItem?: string;
    currentIncident?: string;
    currentIncidentId?: string;
    lastHealthyPlayback?: string;
    lastManifestActivation?: string;
    lastHeartbeatAt?: string;
    playerVersion?: string;
    health: string;
    healthReason: string;
  };
  entries: TimelineEntry[];
};

/**
 * The domains a reader would filter by. These are the Screen Events categories
 * plus the two derived sources — state intervals and incidents — that have no
 * event of their own but belong in the same history.
 */
const domains = [
  { value: "", label: "All" },
  { value: "playback", label: "Playback" },
  { value: "connectivity", label: "Connectivity" },
  { value: "reliability", label: "Reliability" },
  { value: "scheduling", label: "Scheduling" },
  { value: "manifest", label: "Manifest" },
  { value: "commands", label: "Commands" },
  { value: "updates", label: "Updates" },
  { value: "takeovers", label: "Takeovers" },
  { value: "state", label: "State" },
  { value: "incidents", label: "Incidents" },
  { value: "audit", label: "Administrative" },
];

const ranges = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function formatOptional(value?: string) {
  return value ? formatWhen(value) : "Not reported";
}

/**
 * The main diagnostic view for one screen: everything that happened to it, in
 * one order. The compact proof and event columns beside it remain a summary.
 */
export function ScreenTimeline({ screenId }: { screenId: string }) {
  const [domain, setDomain] = useState("");
  const [range, setRange] = useState("24h");
  const query = useQuery({
    queryKey: ["activity", "screen-timeline", screenId, domain, range],
    queryFn: () =>
      activityRequest<ScreenTimeline>(
        `/screens/${screenId}/timeline?range=${range}${domain ? `&domain=${domain}` : ""}`,
      ),
    refetchInterval: 30_000,
  });

  return (
    <section
      className="screen-timeline"
      aria-labelledby="screen-timeline-title"
    >
      <header>
        <div>
          <h3 id="screen-timeline-title">Timeline</h3>
          <p>
            Everything recorded for this screen, in one order: state changes,
            playback, failures, commands, updates, incidents, and administrative
            changes.
          </p>
        </div>
        <div className="screen-timeline__controls">
          <ToggleGroup
            label="Timeline range"
            value={range}
            onValueChange={setRange}
            items={ranges}
          />
        </div>
      </header>

      {query.data?.status && <CurrentStatus status={query.data.status} />}

      <div className="screen-timeline__filters">
        <ToggleGroup
          label="Filter the timeline by domain"
          value={domain}
          onValueChange={setDomain}
          items={domains}
        />
      </div>

      {query.isLoading && <Loading />}
      {query.error && <ErrorNotice error={query.error} />}
      {query.data &&
        // Go marshals an empty slice as null, so the collection is defaulted
        // rather than indexed into blindly.
        ((query.data.entries ?? []).length === 0 ? (
          <EmptyState
            message={
              domain
                ? "Nothing in this domain during the selected period."
                : "Nothing has been recorded for this screen in this period."
            }
          />
        ) : (
          <ol className="screen-timeline__entries">
            {(query.data.entries ?? []).map((entry) => (
              <li
                key={entry.id}
                className={`screen-timeline__entry screen-timeline__entry--${entry.severity}`}
              >
                <time dateTime={entry.timestamp}>
                  {formatWhen(entry.timestamp)}
                </time>
                <span
                  className={`activity-domain activity-domain--${entry.domain}`}
                >
                  {entry.domain}
                </span>
                <div>
                  <strong>{entry.title}</strong>
                  {entry.description && <small>{entry.description}</small>}
                  <span className="screen-timeline__facts">
                    {entry.durationMs != null && (
                      <span>{formatDuration(entry.durationMs)}</span>
                    )}
                    {/* An interval with no end is still running, which is a
                        different statement from one that ended. */}
                    {(entry.kind === "interval" || entry.kind === "session") &&
                      entry.endedAt === undefined &&
                      entry.durationMs == null && <span>Still open</span>}
                    {entry.result && <span>{humanize(entry.result)}</span>}
                    {entry.linkType === "incident" ? (
                      <Link to={buildActivityLink("incidents")}>
                        View incident
                      </Link>
                    ) : (
                      entry.linkId && (
                        <ResourceLink
                          type={entry.linkType}
                          id={entry.linkId}
                          label="Open"
                        />
                      )
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}

function CurrentStatus({ status }: { status: ScreenTimeline["status"] }) {
  return (
    <dl className="screen-timeline__status">
      <div>
        <dt>Health</dt>
        <dd>
          <span
            className={`screen-timeline__health screen-timeline__health--${status.health}`}
          >
            {humanize(status.health)}
          </span>
          {/* The reason is shown beside the classification so it is never an
              unexplained label. */}
          <small>{humanize(status.healthReason)}</small>
        </dd>
      </div>
      <div>
        <dt>Current presentation</dt>
        <dd>{status.currentPresentation || "Not reported"}</dd>
      </div>
      <div>
        <dt>Current item</dt>
        <dd>{status.currentItem || "Not reported"}</dd>
      </div>
      <div>
        <dt>Current incident</dt>
        <dd>
          {status.currentIncident ? (
            <Link to={buildActivityLink("incidents")}>
              {status.currentIncident}
            </Link>
          ) : (
            "None"
          )}
        </dd>
      </div>
      <div>
        <dt>Last healthy playback</dt>
        <dd>{formatOptional(status.lastHealthyPlayback)}</dd>
      </div>
      <div>
        <dt>Last manifest activation</dt>
        <dd>{formatOptional(status.lastManifestActivation)}</dd>
      </div>
      <div>
        <dt>Last heartbeat</dt>
        <dd>{formatOptional(status.lastHeartbeatAt)}</dd>
      </div>
      <div>
        <dt>Player version</dt>
        <dd>{status.playerVersion || "Not reported"}</dd>
      </div>
    </dl>
  );
}
