import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { MetricTile, type ResolvedTimeRange } from "../components/ui";
import {
  activityParams,
  activityRequest,
  EmptyState,
  ErrorNotice,
  humanize,
  Loading,
} from "./ActivityShared";
import {
  IncidentActionButtons,
  IncidentRow,
  isActivelyFailing,
  useCanActOnIncidents,
  useIncidentAction,
  type Incident,
} from "./ActivityIncidentShared";
import { buildActivityLink } from "./activityLinks";

export type { Incident, IncidentStatus } from "./ActivityIncidentShared";

export type IncidentAnalytics = {
  activeIncidents: number;
  incidentsOpened: number;
  incidentsResolved: number;
  meanTimeToRecoverSeconds: number | null;
  medianTimeToRecoverSeconds: number | null;
  longestIncidentSeconds: number | null;
  longestIncidentTitle?: string;
  automaticRecoveries: number;
  manualRecoveries: number;
  recurring: {
    screenId?: string;
    screenName: string;
    incidentType: string;
    incidents: number;
    occurrences: number;
  }[];
  byScreen: Breakdown[];
  byLocation: Breakdown[];
  byDeviceModel: Breakdown[];
  byPlayerVersion: Breakdown[];
  byFailureCode: Breakdown[];
  byType: Breakdown[];
};

type Breakdown = { key: string; label: string; count: number };

function formatSeconds(value: number | null) {
  // Null means nothing recovered in this range. Showing 0 would read as
  // instant recovery, which is the opposite of no data.
  if (value == null) return "No data";
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * The Activity Overview's "Needs attention" section.
 *
 * It reads currently open and acknowledged incidents rather than whichever
 * warning happened to be latest, so a screen that failed five times is one
 * item and a screen that recovered is no longer presented as broken. The list
 * is current state, not a range-scoped report, and says so.
 */
export function NeedsAttentionPanel() {
  const canAct = useCanActOnIncidents();
  const act = useIncidentAction();
  const query = useQuery({
    queryKey: ["activity", "incidents", "active"],
    queryFn: () =>
      activityRequest<{ items: Incident[] }>(`/incidents?status=active`),
    refetchInterval: 30_000,
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  // The server orders these: still-failing first, then by severity, then the
  // longest unresolved, then the most recently updated.
  const items = query.data?.items ?? [];
  const failing = items.filter(isActivelyFailing);
  // Recovered but not yet closed. Kept visible so the follow-up is not lost,
  // and deliberately apart so it is never read as still failing.
  const awaiting = items.filter((item) => item.status === "recovered");

  const actions = (incident: Incident) =>
    canAct ? (
      <IncidentActionButtons
        incident={incident}
        pending={act.isPending}
        onAct={(action) => act.mutate({ id: incident.id, action })}
      />
    ) : undefined;

  return (
    <section
      className="activity-panel activity-incidents"
      aria-label="Needs attention"
    >
      <header>
        <div>
          <h3>
            Needs attention
            {failing.length > 0 && (
              <span className="activity-attention-count">{failing.length}</span>
            )}
          </h3>
          <p>
            Open incidents right now, not over the selected range. Repeats of
            one condition are a single incident.
          </p>
        </div>
        <Link
          className="button button--secondary"
          to={buildActivityLink("incidents")}
        >
          All incidents
        </Link>
      </header>

      {act.error && (
        <div className="notice notice--error">{act.error.message}</div>
      )}

      {failing.length === 0 ? (
        <EmptyState message="Nothing is currently failing." />
      ) : (
        <ul className="activity-incident-list">
          {failing.map((incident) => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              actions={actions(incident)}
            />
          ))}
        </ul>
      )}

      {awaiting.length > 0 && (
        <div className="activity-incidents__awaiting">
          <h4>
            Recovered, awaiting acknowledgement
            <span>{awaiting.length}</span>
          </h4>
          <p>
            These conditions have ended. They stay here until someone closes
            them so the follow-up is not lost.
          </p>
          <ul className="activity-incident-list">
            {awaiting.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                actions={actions(incident)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Incident analytics over the selected range. Every count here is historical
 * except "active incidents", which is labelled as measured now.
 */
export function IncidentAnalyticsPanel({
  range,
}: {
  range: ResolvedTimeRange;
}) {
  const query = useQuery({
    queryKey: ["activity", "incident-analytics", range.from, range.to],
    queryFn: () =>
      activityRequest<IncidentAnalytics>(
        `/incidents/analytics?${activityParams(range, {}).toString()}`,
      ),
  });
  const data = query.data;
  if (!data) return null;
  // Go marshals empty slices as null, and an older server may not send these
  // collections at all; the panel indexes into them directly.
  const recurring = data.recurring ?? [];

  return (
    <section
      className="activity-panel activity-incident-analytics-panel"
      aria-label="Incident analytics"
    >
      <header>
        <div>
          <h3>Incident analytics</h3>
          <p>
            Measured over {range.label}, except where a tile says otherwise.
          </p>
        </div>
      </header>
      <div className="activity-incident-analytics">
        <div className="activity-incident-analytics__tiles">
          <MetricTile
            label="Active incidents"
            value={data.activeIncidents}
            // The one tile that is not range-scoped, said plainly rather than
            // left to look like part of the historical set.
            hint="Right now, not over the range"
          />
          <MetricTile
            label="Opened"
            value={data.incidentsOpened}
            hint={`During ${range.label}`}
          />
          <MetricTile
            label="Resolved"
            value={data.incidentsResolved}
            hint={`During ${range.label}`}
          />
          <MetricTile
            label="Mean time to recover"
            value={formatSeconds(data.meanTimeToRecoverSeconds)}
            // The median is shown beside the mean because one long outage
            // drags the mean away from the typical case.
            hint={`Median ${formatSeconds(data.medianTimeToRecoverSeconds)}`}
          />
          <MetricTile
            label="Longest incident"
            value={formatSeconds(data.longestIncidentSeconds)}
            hint={data.longestIncidentTitle || `During ${range.label}`}
          />
          <MetricTile
            label="Recovered on their own"
            value={data.automaticRecoveries}
            hint={`${data.manualRecoveries} closed by hand`}
          />
        </div>

        {recurring.length > 0 && (
          <div className="activity-incident-recurring">
            <h4>Recurring problems</h4>
            <ul>
              {recurring.map((item) => (
                <li key={`${item.screenId}-${item.incidentType}`}>
                  <span>
                    <strong>{item.screenName}</strong>
                    <small>{humanize(item.incidentType)}</small>
                  </span>
                  {/* Separate counts: five short outages and one outage
                      reported five times are different problems. */}
                  <span>
                    {item.incidents} incidents · {item.occurrences} occurrences
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="activity-incident-breakdowns">
          {(
            [
              ["By screen", data.byScreen ?? []],
              ["By location", data.byLocation ?? []],
              ["By device model", data.byDeviceModel ?? []],
              ["By Player version", data.byPlayerVersion ?? []],
              ["By failure code", data.byFailureCode ?? []],
              ["By category", data.byType ?? []],
            ] as [string, Breakdown[]][]
          )
            .filter(([, items]) => items.length > 0)
            .map(([label, items]) => (
              <section key={label}>
                <h4>{label}</h4>
                <ul>
                  {items.slice(0, 6).map((item) => (
                    <li key={item.key || item.label}>
                      <span>{humanize(item.label)}</span>
                      <span>{item.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      </div>
    </section>
  );
}
