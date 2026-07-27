import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { MonitorCheck, TriangleAlert } from "lucide-react";
import {
  MetricTile,
  ToggleGroup,
  type MetricDelta,
  type MetricDirection,
  type ResolvedTimeRange,
} from "../components/ui";
import { FleetUptimePanel } from "../components/FleetUptimePanel";
import {
  activityParams,
  activityRequest,
  EmptyState,
  ErrorNotice,
  formatDuration,
  formatWhen,
  humanize,
  Loading,
  ResultBadge,
} from "./ActivityShared";
import type { Overview } from "./ActivityShared";

/** Most urgent first, so the worst problem is never below the fold. */
const severityRank: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
};

type MetricSpec = {
  key: keyof Overview["cards"];
  label: string;
  direction: MetricDirection;
  /** Where the records behind the number live. */
  to: string;
  hint?: string;
  format?: (value: number) => string;
};

const primaryMetrics: MetricSpec[] = [
  {
    key: "confirmedPlaybackDurationMs",
    label: "Confirmed playback",
    direction: "up-is-good",
    to: "/activity?tab=proof",
    format: formatDuration,
  },
  {
    key: "playbackFailures",
    label: "Playback failures",
    direction: "up-is-bad",
    to: "/activity?tab=proof&result=failed",
  },
  {
    key: "interruptedPlays",
    label: "Interrupted plays",
    direction: "up-is-bad",
    to: "/activity?tab=proof&result=partial",
  },
  {
    key: "emergencyActivations",
    label: "Emergency activations",
    direction: "neutral",
    to: "/activity?tab=events&category=emergencies",
  },
];

const secondaryMetrics: MetricSpec[] = [
  {
    key: "failedPlayerUpdates",
    label: "Failed Player updates",
    direction: "up-is-bad",
    to: "/activity?tab=events&category=updates&result=failed",
  },
  {
    key: "recentAdministrativeChanges",
    label: "Administrative changes",
    direction: "neutral",
    to: "/activity?tab=audit&result=success",
  },
];

export function OverviewTab({ range }: { range: ResolvedTimeRange }) {
  const query = useQuery({
    queryKey: ["activity", "overview", range.from, range.to],
    queryFn: () =>
      activityRequest<Overview>(
        `/overview?${activityParams(range, {}).toString()}`,
      ),
    refetchInterval: 30_000,
  });
  // The comparison period is fetched separately so a delta reflects the same
  // measurement over the window immediately before this one.
  const previous = useQuery({
    queryKey: [
      "activity",
      "overview",
      range.previous?.from,
      range.previous?.to,
    ],
    queryFn: () =>
      activityRequest<Overview>(
        `/overview?${activityParams(range.previous!, {}).toString()}`,
      ),
    enabled: Boolean(range.previous),
  });

  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const data = query.data;
  if (!data) return null;
  // Older servers marshal empty Go slices as null.
  const needsAttention = [...(data.needsAttention ?? [])].sort(
    (a, b) =>
      (severityRank[a.severity] ?? 3) - (severityRank[b.severity] ?? 3) ||
      b.occurredAt.localeCompare(a.occurredAt),
  );
  const timeline = data.timeline ?? [];

  function deltaFor(spec: MetricSpec): MetricDelta | undefined {
    const comparison = range.previous;
    if (!comparison || !previous.data) return undefined;
    return {
      change:
        Number(data!.cards[spec.key]) - Number(previous.data.cards[spec.key]),
      comparisonLabel: comparison.label,
      direction: spec.direction,
      format: spec.format,
    };
  }

  function tile(spec: MetricSpec) {
    const raw = Number(data!.cards[spec.key]);
    return (
      <MetricTile
        key={spec.key}
        label={spec.label}
        value={spec.format ? spec.format(raw) : raw}
        hint={spec.hint}
        to={spec.to}
        delta={deltaFor(spec)}
      />
    );
  }

  return (
    <div className="activity-overview">
      <section className="activity-health" aria-label="Fleet health">
        <MetricTile
          icon={MonitorCheck}
          label="Screens reporting normally"
          value={data.cards.screensReportingNormally}
          hint="Right now, not over the selected range"
          to="/screens"
        />
        <MetricTile
          icon={TriangleAlert}
          label="Screens with playback gaps"
          value={data.cards.screensWithPlaybackGaps}
          hint={`Seen during ${range.label}`}
          to="/activity?tab=events&severity=error"
        />
      </section>

      <section className="activity-panel">
        <header>
          <div>
            <h3>
              Needs attention
              {needsAttention.length > 0 && (
                <span className="activity-attention-count">
                  {needsAttention.length}
                </span>
              )}
            </h3>
            <p>Current unresolved operational issues, most urgent first.</p>
          </div>
        </header>
        {needsAttention.length === 0 ? (
          <EmptyState message="No unresolved Activity issues in this range." />
        ) : (
          <div className="activity-attention-list">
            {needsAttention.map((item) => (
              <Link
                key={`${item.screenId}-${item.kind}`}
                to={`/screens/${item.screenId}?tab=activity`}
              >
                <ResultBadge value={item.severity} />
                <span>
                  <strong>{item.screenName}</strong>
                  <small>{item.description}</small>
                </span>
                <time>{formatWhen(item.occurredAt)}</time>
              </Link>
            ))}
          </div>
        )}
      </section>

      <FleetUptimePanel description="Measured player time spent connected and playing, over its own fixed window rather than the range selected above." />

      <section className="activity-metrics" aria-label="Activity totals">
        <div className="activity-metrics__primary">
          {primaryMetrics.map(tile)}
        </div>
        <div className="activity-metrics__secondary">
          {secondaryMetrics.map(tile)}
        </div>
      </section>

      <ImportantTimeline items={timeline} />
    </div>
  );
}

function ImportantTimeline({ items }: { items: Overview["timeline"] }) {
  const [domain, setDomain] = useState("all");
  const domains = useMemo(
    () => [...new Set(items.map((item) => item.domain))].sort(),
    [items],
  );
  const visible = useMemo(
    () => items.filter((item) => domain === "all" || item.domain === domain),
    [domain, items],
  );
  // Events arrive newest first, so day groups keep that order.
  const days = useMemo(() => {
    const grouped = new Map<string, Overview["timeline"]>();
    for (const item of visible) {
      const day = new Date(item.timestamp).toDateString();
      grouped.set(day, [...(grouped.get(day) ?? []), item]);
    }
    return [...grouped.entries()];
  }, [visible]);

  return (
    <section className="activity-panel">
      <header>
        <div>
          <h3>Important timeline</h3>
          <p>
            High-value playback, recovery, emergency, and administrative events.
          </p>
        </div>
        {domains.length > 1 && (
          <ToggleGroup
            label="Filter the timeline by domain"
            value={domain}
            onValueChange={setDomain}
            items={[
              { value: "all", label: "All" },
              ...domains.map((value) => ({
                value,
                label: humanize(value),
              })),
            ]}
          />
        )}
      </header>
      {visible.length === 0 ? (
        <EmptyState message="No high-value events occurred in this range." />
      ) : (
        <div className="activity-timeline-days">
          {days.map(([day, entries]) => (
            <section key={day}>
              <h4>{day}</h4>
              <ol className="activity-timeline">
                {entries.map((item) => (
                  <li key={`${item.domain}-${item.id}`}>
                    <time>{formatWhen(item.timestamp)}</time>
                    <span
                      className={`activity-domain activity-domain--${item.domain}`}
                    >
                      {item.domain}
                    </span>
                    <p>{item.description}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
