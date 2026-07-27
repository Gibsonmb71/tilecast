import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { activityRequest } from "../pages/ActivityShared";
import "./ActivityRetentionPanel.css";

type Retention = {
  rawEventDays: number;
  playbackSessionDays: number;
  screenStateDays: number;
  auditLogDays: number;
  diagnosticMetadataDays: number;
  updatedAt: string;
};

type RetentionNumberKey = Exclude<keyof Retention, "updatedAt">;

const fields: [RetentionNumberKey, string, number, number][] = [
  ["rawEventDays", "Raw Player activity events", 7, 365],
  ["playbackSessionDays", "Proof-of-play sessions", 30, 2555],
  ["screenStateDays", "Screen state intervals", 30, 2555],
  ["auditLogDays", "Audit logs", 90, 3650],
  ["diagnosticMetadataDays", "Detailed diagnostic metadata", 7, 180],
];

/**
 * How long Activity keeps each class of record. This is configuration rather
 * than reporting, so it lives with the other retention settings instead of on
 * the Activity page it governs.
 */
export function ActivityRetentionPanel({ editable }: { editable: boolean }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["activity", "retention"],
    queryFn: () => activityRequest<Retention>("/retention"),
    enabled: editable,
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
          "X-CSRF-Token": auth.status?.csrfToken ?? "",
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
  if (!editable || !value) return null;
  return (
    <section className="retention-panel">
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
      <div className="retention-panel__grid">
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
