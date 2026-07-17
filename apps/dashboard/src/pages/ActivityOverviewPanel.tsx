import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  AlertTriangle,
  Clock3,
  FileCheck2,
  History,
  MonitorCheck,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  activityParams,
  activityRequest,
  EmptyState,
  ErrorNotice,
  formatDuration,
  formatWhen,
  Loading,
  ResultBadge,
} from "./ActivityShared";
import type { Overview } from "./ActivityShared";

export function OverviewTab({
  range,
  canManageRetention,
  csrfToken,
}: {
  range: { from: string; to: string };
  canManageRetention: boolean;
  csrfToken: string;
}) {
  const query = useQuery({
    queryKey: ["activity", "overview", range],
    queryFn: () =>
      activityRequest<Overview>(
        `/overview?${activityParams(range, {}).toString()}`,
      ),
    refetchInterval: 30_000,
  });
  if (query.isLoading) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const data = query.data;
  if (!data) return null;
  // Older servers marshal empty Go slices as null.
  const needsAttention = data.needsAttention ?? [];
  const timeline = data.timeline ?? [];
  const cards = [
    [
      "Screens reporting normally",
      data.cards.screensReportingNormally,
      MonitorCheck,
    ],
    [
      "Screens with playback gaps",
      data.cards.screensWithPlaybackGaps,
      TriangleAlert,
    ],
    [
      "Confirmed playback duration",
      formatDuration(data.cards.confirmedPlaybackDurationMs),
      Clock3,
    ],
    ["Playback failures", data.cards.playbackFailures, AlertTriangle],
    ["Interrupted plays", data.cards.interruptedPlays, History],
    ["Emergency activations", data.cards.emergencyActivations, ShieldCheck],
    ["Failed Player updates", data.cards.failedPlayerUpdates, TriangleAlert],
    [
      "Recent administrative changes",
      data.cards.recentAdministrativeChanges,
      FileCheck2,
    ],
  ] as const;
  return (
    <div className="activity-overview">
      <section className="activity-summary-grid" aria-label="Activity summary">
        {cards.map(([label, value, Icon]) => (
          <article key={label}>
            <Icon size={18} aria-hidden="true" />
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
      <div className="activity-overview-columns">
        <section className="activity-panel">
          <header>
            <div>
              <h3>Needs attention</h3>
              <p>Current unresolved operational issues.</p>
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
        <section className="activity-panel">
          <header>
            <div>
              <h3>Important timeline</h3>
              <p>
                High-value playback, recovery, emergency, and administrative
                events.
              </p>
            </div>
          </header>
          {timeline.length === 0 ? (
            <EmptyState message="No high-value events occurred in this range." />
          ) : (
            <ol className="activity-timeline">
              {timeline.map((item) => (
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
          )}
        </section>
      </div>
      {canManageRetention && <RetentionSettings csrfToken={csrfToken} />}
    </div>
  );
}

function RetentionSettings({ csrfToken }: { csrfToken: string }) {
  type Retention = {
    rawEventDays: number;
    playbackSessionDays: number;
    screenStateDays: number;
    auditLogDays: number;
    diagnosticMetadataDays: number;
    updatedAt: string;
  };
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["activity", "retention"],
    queryFn: () => activityRequest<Retention>("/retention"),
  });
  const [draft, setDraft] = useState<Retention | null>(null);
  const value = draft ?? query.data ?? null;
  const save = useMutation({
    mutationFn: async (input: Retention) => {
      const response = await fetch("/api/v1/activity/retention", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(input),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: Retention;
        error?: { message?: string };
      };
      if (!response.ok || !body.data)
        throw new Error(
          body.error?.message ?? "Retention settings could not be saved.",
        );
      return body.data;
    },
    onSuccess: (next) => {
      setDraft(null);
      queryClient.setQueryData(["activity", "retention"], next);
    },
  });
  if (!value) return null;
  type RetentionNumberKey = Exclude<keyof Retention, "updatedAt">;
  const fields: [RetentionNumberKey, string, number, number][] = [
    ["rawEventDays", "Raw Player activity events", 7, 365],
    ["playbackSessionDays", "Proof-of-play sessions", 30, 2555],
    ["screenStateDays", "Screen state intervals", 30, 2555],
    ["auditLogDays", "Audit logs", 90, 3650],
    ["diagnosticMetadataDays", "Detailed diagnostic metadata", 7, 180],
  ];
  return (
    <section className="activity-panel activity-retention">
      <header>
        <div>
          <h3>Activity retention</h3>
          <p>
            Cleanup runs in bounded background batches and respects deployment
            hard limits.
          </p>
        </div>
        <button
          className="button button--primary"
          type="button"
          disabled={save.isPending || !draft}
          onClick={() => draft && save.mutate(draft)}
        >
          {save.isPending ? "Saving…" : "Save retention"}
        </button>
      </header>
      {save.error && (
        <div className="notice notice--error">{save.error.message}</div>
      )}
      <div className="activity-retention-grid">
        {fields.map(([key, label, min, max]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              value={Number(value[key])}
              onChange={(event) =>
                setDraft({ ...value, [key]: Number(event.target.value) })
              }
            />
            <small>
              {min}–{max} days
            </small>
          </label>
        ))}
      </div>
    </section>
  );
}
