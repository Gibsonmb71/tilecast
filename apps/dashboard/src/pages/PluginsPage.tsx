import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock3, Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { api } from "../api/client";
import type { CountdownBarInput } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  Button,
  EmptyState,
  Notice,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import "./PluginsPage.css";

const dayOptions = [
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
] as const;

const formSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    message: z.string().trim().min(1).max(280),
    scheduleType: z.enum(["weekly", "one_time"]),
    targetTime: z.string(),
    daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)),
    oneTimeAt: z.string(),
    timezone: z
      .string({ error: "Enter an IANA timezone such as America/Chicago." })
      .trim()
      .min(1, "Enter an IANA timezone such as America/Chicago.")
      .max(100, "Enter an IANA timezone such as America/Chicago."),
    leadMinutes: z.coerce
      .number({ error: "Enter a whole number of minutes." })
      .int("Enter a whole number of minutes.")
      .min(1, "Lead time must be between 1 and 43200 minutes.")
      .max(43_200, "Lead time must be between 1 and 43200 minutes."),
    completionText: z.string().trim().max(280),
    displayMode: z.enum(["overlay", "push"]),
    heightPx: z.coerce
      .number({ error: "Enter a height between 40 and 320 pixels." })
      .int("Enter a height between 40 and 320 pixels.")
      .min(40, "Enter a height between 40 and 320 pixels.")
      .max(320, "Enter a height between 40 and 320 pixels."),
    enabled: z.boolean(),
    priority: z.coerce
      .number({ error: "Enter a priority between -1000 and 1000." })
      .int("Enter a priority between -1000 and 1000.")
      .min(-1000, "Enter a priority between -1000 and 1000.")
      .max(1000, "Enter a priority between -1000 and 1000."),
    targetScope: z.enum(["all", "screens", "sync_groups", "locations"]),
    targetIds: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (
      value.scheduleType === "weekly" &&
      (!/^\d{2}:\d{2}$/.test(value.targetTime) || value.daysOfWeek.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["daysOfWeek"],
        message: "Choose a target time and at least one day.",
      });
    }
    if (value.scheduleType === "one_time" && !value.oneTimeAt) {
      context.addIssue({
        code: "custom",
        path: ["oneTimeAt"],
        message: "Choose the one-time target date and time.",
      });
    }
    if (value.targetScope !== "all" && value.targetIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["targetIds"],
        message: "Choose at least one target.",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;
type FormInput = z.input<typeof formSchema>;

const defaultValues: FormValues = {
  name: "",
  message: "Lunch ends in",
  scheduleType: "weekly",
  targetTime: "12:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  oneTimeAt: "",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  leadMinutes: 15,
  completionText: "",
  displayMode: "overlay",
  heightPx: 72,
  enabled: true,
  priority: 0,
  targetScope: "all",
  targetIds: [],
};

function canManage(role?: string) {
  return role === "owner" || role === "administrator";
}

/**
 * `datetime-local` inputs carry no zone, and the submit path reads them back
 * with `new Date(value)` — the browser's own zone. Formatting the stored
 * instant the same way keeps the round trip stable instead of shifting the
 * target by the browser's UTC offset on every edit.
 */
function toLocalInputValue(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function PluginsPage() {
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: api.plugins });
  return (
    <main className="page plugins-page">
      <PageHeader
        title="Plugins"
        description="Built-in Tilecast features that can affect Player behavior outside playlists and Layout zones."
      />
      {plugins.isError && (
        <Notice variant="danger">Plugins could not be loaded.</Notice>
      )}
      <div className="plugin-card-grid">
        {(plugins.data?.items ?? []).map((plugin) => (
          <article className="plugin-card" key={plugin.id}>
            <div className="plugin-card__icon" aria-hidden="true">
              <Clock3 size={24} />
            </div>
            <div className="plugin-card__copy">
              <div className="plugin-card__heading">
                <h2>{plugin.name}</h2>
                <StatusBadge
                  label={plugin.enabled ? "Enabled" : "Disabled"}
                  tone={plugin.enabled ? "success" : "neutral"}
                />
              </div>
              <p>{plugin.description}</p>
              <span className="plugin-card__instances">
                {plugin.instanceCount} configured{" "}
                {plugin.instanceCount === 1 ? "instance" : "instances"}
              </span>
            </div>
            <Link
              className="button button--secondary"
              to="/plugins/countdown-bar"
            >
              Manage plugin
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}

export function CountdownBarsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const instances = useQuery({
    queryKey: ["countdown-bars"],
    queryFn: api.countdownBars,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.deleteCountdownBar(id, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["countdown-bars"] });
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
    },
  });
  const manageable = canManage(auth.status?.user?.role);
  // Only a successful, empty list is "nothing configured" — a failed load must
  // not read as an empty fleet.
  const showEmptyState =
    !instances.isError &&
    !instances.isLoading &&
    (instances.data?.items.length ?? 0) === 0;
  return (
    <main className="page plugins-page">
      <PageHeader
        eyebrow={
          <Link className="back-link" to="/plugins">
            <ArrowLeft size={15} /> Plugins
          </Link>
        }
        title="Countdown Bar"
        description="Timed bars run independently of the playlist and keep evaluating from the Player's cached manifest."
        actions={
          manageable ? (
            <Link
              className="button button--primary"
              to="/plugins/countdown-bar/new"
            >
              <Plus size={16} /> New instance
            </Link>
          ) : undefined
        }
      />
      {!manageable && (
        <Notice>
          Owner or Administrator access is required to make changes.
        </Notice>
      )}
      {instances.isError && (
        <Notice variant="danger">Countdown bars could not be loaded.</Notice>
      )}
      {remove.isError && (
        <Notice variant="danger">{remove.error.message}</Notice>
      )}
      {showEmptyState ? (
        <EmptyState
          icon={<Clock3 />}
          title="No countdown bars configured"
          message="Create an instance to show a locally-timed bar on selected screens."
          action={
            manageable ? (
              <Link
                className="button button--primary"
                to="/plugins/countdown-bar/new"
              >
                Create instance
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="plugin-instance-list">
          {(instances.data?.items ?? []).map((instance) => (
            <article className="plugin-instance" key={instance.id}>
              <div>
                <div className="plugin-instance__heading">
                  <h2>{instance.name}</h2>
                  <StatusBadge
                    label={instance.enabled ? "Enabled" : "Disabled"}
                    tone={instance.enabled ? "success" : "neutral"}
                  />
                </div>
                <p>
                  {instance.message} · {instance.displayMode} ·{" "}
                  {instance.heightPx}px · priority {instance.priority}
                </p>
              </div>
              <div className="plugin-instance__actions">
                <Link
                  className="button button--secondary"
                  to={`/plugins/countdown-bar/${instance.id}`}
                >
                  Manage
                </Link>
                {manageable && (
                  <Button
                    compact
                    variant="danger"
                    aria-label={`Delete ${instance.name}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete “${instance.name}”? The bar will be removed from targeted Players.`,
                        )
                      )
                        remove.mutate(instance.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

export function CountdownBarEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instance = useQuery({
    queryKey: ["countdown-bar", id],
    queryFn: () => api.countdownBar(id ?? ""),
    enabled: editing,
  });
  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const groups = useQuery({
    queryKey: ["screen-groups"],
    queryFn: () => api.screenGroups(),
  });
  const locations = useQuery({
    queryKey: ["locations"],
    queryFn: api.locations,
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });
  useEffect(() => {
    if (!instance.data) return;
    const value = instance.data;
    reset({
      name: value.name,
      message: value.message,
      scheduleType: value.scheduleType,
      targetTime: value.targetTime ?? "",
      daysOfWeek: value.daysOfWeek,
      oneTimeAt: value.oneTimeAt ? toLocalInputValue(value.oneTimeAt) : "",
      timezone: value.timezone,
      leadMinutes: value.leadTimeSeconds / 60,
      completionText: value.completionText,
      displayMode: value.displayMode,
      heightPx: value.heightPx,
      enabled: value.enabled,
      priority: value.priority,
      targetScope: value.targetScope,
      targetIds: value.targetIds,
    });
  }, [instance.data, reset]);
  const save = useMutation({
    mutationFn: (input: CountdownBarInput) =>
      editing
        ? api.updateCountdownBar(id ?? "", input, auth.status?.csrfToken ?? "")
        : api.createCountdownBar(input, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["countdown-bars"] });
      void queryClient.invalidateQueries({ queryKey: ["plugins"] });
      void navigate("/plugins/countdown-bar");
    },
  });
  const scheduleType = watch("scheduleType");
  const targetScope = watch("targetScope");
  const targetScopeField = register("targetScope");
  const targets =
    targetScope === "screens"
      ? screens.data?.items.map((item) => ({ id: item.id, name: item.name }))
      : targetScope === "sync_groups"
        ? groups.data?.items.map((item) => ({ id: item.id, name: item.name }))
        : targetScope === "locations"
          ? locations.data?.items.map((item) => ({
              id: item.id,
              name: item.name,
            }))
          : [];
  const submit = (values: FormValues) => {
    save.mutate({
      name: values.name,
      message: values.message,
      scheduleType: values.scheduleType,
      targetTime:
        values.scheduleType === "weekly" ? values.targetTime : undefined,
      daysOfWeek: values.scheduleType === "weekly" ? values.daysOfWeek : [],
      oneTimeAt:
        values.scheduleType === "one_time"
          ? new Date(values.oneTimeAt).toISOString()
          : undefined,
      timezone: values.timezone,
      leadTimeSeconds: values.leadMinutes * 60,
      completionText: values.completionText,
      displayMode: values.displayMode,
      heightPx: values.heightPx,
      enabled: values.enabled,
      priority: values.priority,
      targetScope: values.targetScope,
      targetIds: values.targetScope === "all" ? [] : values.targetIds,
    });
  };
  return (
    <main className="page plugins-page">
      <PageHeader
        eyebrow={
          <Link className="back-link" to="/plugins/countdown-bar">
            <ArrowLeft size={15} /> Countdown Bar
          </Link>
        }
        title={editing ? "Manage countdown bar" : "New countdown bar"}
        description="The Player evaluates this schedule locally. Priority decides which bar wins when instances overlap."
      />
      <form
        className="plugin-form"
        onSubmit={(event) => void handleSubmit(submit)(event)}
      >
        <section className="plugin-form__section">
          <h2>Content</h2>
          <label>
            Name
            <input {...register("name")} />
            {errors.name && <small>{errors.name.message}</small>}
          </label>
          <label>
            Message
            <input {...register("message")} />
            {errors.message && <small>{errors.message.message}</small>}
          </label>
          <label>
            Optional completion text
            <input
              {...register("completionText")}
              placeholder="Lunch is over"
            />
            <span className="field-help">
              Shown for one minute after the target; leave blank to hide at
              zero.
            </span>
          </label>
        </section>

        <section className="plugin-form__section">
          <h2>Timing</h2>
          <label>
            Schedule
            <select {...register("scheduleType")}>
              <option value="weekly">Days of the week</option>
              <option value="one_time">One-time date</option>
            </select>
          </label>
          {scheduleType === "weekly" ? (
            <>
              <label>
                Target time
                <input type="time" {...register("targetTime")} />
              </label>
              <fieldset>
                <legend>Days of the week</legend>
                <div className="day-picker">
                  {dayOptions.map(([label, value]) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        value={value}
                        {...register("daysOfWeek")}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {errors.daysOfWeek && (
                  <small>{errors.daysOfWeek.message}</small>
                )}
              </fieldset>
            </>
          ) : (
            <label>
              Target date and time
              <input type="datetime-local" {...register("oneTimeAt")} />
              <span className="field-help">
                Entered in this browser's local time; the Player counts down to
                the same instant.
              </span>
              {errors.oneTimeAt && <small>{errors.oneTimeAt.message}</small>}
            </label>
          )}
          <div className="plugin-form__row">
            <label>
              Timezone
              <input
                {...register("timezone")}
                aria-invalid={errors.timezone ? true : undefined}
                aria-describedby={
                  errors.timezone ? "countdown-timezone-error" : undefined
                }
              />
              {errors.timezone && (
                <small id="countdown-timezone-error">
                  {errors.timezone.message}
                </small>
              )}
            </label>
            <label>
              Appear this many minutes before
              <input
                type="number"
                min={1}
                max={43_200}
                {...register("leadMinutes", { valueAsNumber: true })}
                aria-invalid={errors.leadMinutes ? true : undefined}
                aria-describedby={
                  errors.leadMinutes ? "countdown-lead-error" : undefined
                }
              />
              {errors.leadMinutes && (
                <small id="countdown-lead-error">
                  {errors.leadMinutes.message}
                </small>
              )}
            </label>
          </div>
        </section>

        <section className="plugin-form__section">
          <h2>Display</h2>
          <div className="plugin-form__row">
            <label>
              Mode
              <select {...register("displayMode")}>
                <option value="overlay">Overlay current content</option>
                <option value="push">Push and shrink current content</option>
              </select>
            </label>
            <label>
              Bottom-bar height (px)
              <input
                type="number"
                min={40}
                max={320}
                {...register("heightPx", { valueAsNumber: true })}
                aria-invalid={errors.heightPx ? true : undefined}
                aria-describedby={
                  errors.heightPx ? "countdown-height-error" : undefined
                }
              />
              {errors.heightPx && (
                <small id="countdown-height-error">
                  {errors.heightPx.message}
                </small>
              )}
            </label>
            <label>
              Priority
              <input
                type="number"
                min={-1000}
                max={1000}
                {...register("priority", { valueAsNumber: true })}
                aria-invalid={errors.priority ? true : undefined}
                aria-describedby={
                  errors.priority ? "countdown-priority-error" : undefined
                }
              />
              {errors.priority && (
                <small id="countdown-priority-error">
                  {errors.priority.message}
                </small>
              )}
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" {...register("enabled")} />
            Enabled
          </label>
        </section>

        <section className="plugin-form__section">
          <h2>Targets</h2>
          <label>
            Target type
            <select
              {...targetScopeField}
              onChange={(event) => {
                // Ids from the previous scope would otherwise stay registered
                // and be submitted alongside the new scope's picks.
                setValue("targetIds", []);
                void targetScopeField.onChange(event);
              }}
            >
              <option value="all">All screens</option>
              <option value="screens">Individual screens</option>
              <option value="sync_groups">Sync groups</option>
              <option value="locations">Locations</option>
            </select>
          </label>
          {targetScope !== "all" && (
            <fieldset>
              <legend>Choose targets</legend>
              <div className="target-picker">
                {(targets ?? []).map((target) => (
                  <label key={target.id}>
                    <input
                      type="checkbox"
                      value={target.id}
                      {...register("targetIds")}
                    />
                    {target.name}
                  </label>
                ))}
              </div>
              {errors.targetIds && <small>{errors.targetIds.message}</small>}
            </fieldset>
          )}
        </section>

        {save.isError && <Notice variant="danger">{save.error.message}</Notice>}
        <div className="plugin-form__actions">
          <Link
            className="button button--secondary"
            to="/plugins/countdown-bar"
          >
            Cancel
          </Link>
          <Button type="submit" variant="primary" loading={save.isPending}>
            {editing ? "Save changes" : "Create instance"}
          </Button>
        </div>
      </form>
    </main>
  );
}
