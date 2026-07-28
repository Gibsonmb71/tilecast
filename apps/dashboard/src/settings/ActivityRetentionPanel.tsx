import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
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
 * The server enforces these bounds too. Checking them here keeps a rejected
 * value in the field the person is editing instead of returning it as a whole
 * failed request, and stops an emptied field from being sent as zero.
 */
const fieldSchemas = new Map(
  fields.map(([key, label, min, max]) => [
    key,
    z
      .string()
      .trim()
      .min(1, `${label} is required.`)
      .regex(/^\d+$/, `${label} must be a whole number of days.`)
      .transform(Number)
      .refine(
        (value) => value >= min && value <= max,
        `${label} must be between ${min} and ${max} days.`,
      ),
  ]),
);

type Draft = Record<RetentionNumberKey, string>;

type Validation =
  | { ok: true; payload: Record<RetentionNumberKey, number> }
  | { ok: false; errors: Partial<Record<RetentionNumberKey, string>> };

function validate(draft: Draft): Validation {
  const payload = {} as Record<RetentionNumberKey, number>;
  const errors: Partial<Record<RetentionNumberKey, string>> = {};
  for (const [key] of fields) {
    const result = fieldSchemas.get(key)!.safeParse(draft[key]);
    if (result.success) payload[key] = result.data;
    else errors[key] = result.error.issues[0]?.message;
  }
  return Object.keys(errors).length
    ? { ok: false, errors }
    : { ok: true, payload };
}

function draftFrom(value: Retention): Draft {
  return Object.fromEntries(
    fields.map(([key]) => [key, String(value[key])]),
  ) as Draft;
}

/**
 * How long Activity keeps each class of record. This is configuration rather
 * than reporting, so it lives with the other retention settings instead of on
 * the Activity page it governs.
 */
export function ActivityRetentionPanel({
  editable,
  onDirtyChange,
}: {
  editable: boolean;
  /** Lets Settings fold unsaved retention edits into its leave warning. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["activity", "retention"],
    queryFn: () => activityRequest<Retention>("/retention"),
    enabled: editable,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const persisted = query.data ? draftFrom(query.data) : null;
  const dirty = Boolean(
    draft && persisted && fields.some(([key]) => draft[key] !== persisted[key]),
  );

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: async (input: Record<RetentionNumberKey, number>) => {
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

  if (!editable) return null;

  const value = draft ?? persisted;
  const checked = value ? validate(value) : undefined;
  const errors = checked && !checked.ok ? checked.errors : {};

  return (
    <section className="retention-panel" aria-busy={query.isPending}>
      <header>
        <div>
          <h3>Activity retention</h3>
          <p>
            Cleanup runs in bounded background batches and respects deployment
            hard limits.
          </p>
        </div>
        {value && (
          <button
            className="button button--primary"
            type="button"
            disabled={save.isPending || !dirty || !checked?.ok}
            onClick={() => checked?.ok && save.mutate(checked.payload)}
          >
            {save.isPending ? "Saving…" : "Save retention"}
          </button>
        )}
      </header>

      {query.isPending && (
        <p className="retention-panel__status">Loading retention settings…</p>
      )}
      {query.error && (
        <div className="notice notice--error retention-panel__status">
          <span>
            {query.error instanceof Error
              ? query.error.message
              : "Retention settings could not be loaded."}
          </span>
          <button
            type="button"
            className="button button--secondary button--compact"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
      {save.error && (
        <div className="notice notice--error">{save.error.message}</div>
      )}

      {value && (
        <div className="retention-panel__grid">
          {fields.map(([key, label, min, max]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                value={value[key]}
                aria-invalid={errors[key] ? true : undefined}
                aria-describedby={`retention-${key}-hint`}
                onChange={(event) =>
                  setDraft({ ...value, [key]: event.target.value })
                }
              />
              <small id={`retention-${key}-hint`}>
                {errors[key] ?? `${min}–${max} days`}
              </small>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
