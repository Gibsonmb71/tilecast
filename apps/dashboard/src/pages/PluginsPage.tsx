import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ClipboardList,
  Clock3,
  Plus,
  Puzzle,
  Siren,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { api } from "../api/client";
import type { CountdownBarInput } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { FormField } from "../components/FormField";
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Panel,
  SectionHeader,
  Select,
  StatusBadge,
} from "../components/ui";
import { scheduleWeekdays } from "../schedules/scheduleBuilderModel";
import "./PluginsPage.css";

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
    progressFill: z.enum(["none", "drain"]),
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
  progressFill: "none",
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

/**
 * How Studio presents each plugin the server reports. The server owns the
 * catalog; this is only the icon and the page that manages it. A plugin Studio
 * does not recognise still gets a card — a newer server must not silently drop
 * a feature from the list — it just carries the generic icon and no link.
 */
const pluginPresentation: Record<
  string,
  { icon: LucideIcon; path: string; instanceNoun: [string, string] }
> = {
  countdown_bar: {
    icon: Clock3,
    path: "/plugins/countdown-bar",
    instanceNoun: ["instance", "instances"],
  },
  emergency_alerts: {
    icon: Siren,
    path: "/plugins/emergency-alerts",
    instanceNoun: ["alert rule", "alert rules"],
  },
  forms: {
    icon: ClipboardList,
    path: "/plugins/forms",
    instanceNoun: ["form", "forms"],
  },
};

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
        {(plugins.data?.items ?? []).map((plugin) => {
          const presentation = pluginPresentation[plugin.id];
          const Icon = presentation?.icon ?? Puzzle;
          const [one, many] = presentation?.instanceNoun ?? [
            "instance",
            "instances",
          ];
          return (
            <article className="plugin-card" key={plugin.id}>
              <div className="plugin-card__icon" aria-hidden="true">
                <Icon size={24} />
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
                  {plugin.instanceCount === 1 ? one : many}
                </span>
              </div>
              {presentation && (
                <Link
                  className="button button--secondary"
                  to={presentation.path}
                >
                  Manage plugin
                </Link>
              )}
            </article>
          );
        })}
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
      progressFill: value.progressFill ?? "none",
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
  const displayMode = watch("displayMode");
  const progressFill = watch("progressFill");
  // Signal Select owns the ref on its hidden native select, so register()'s ref
  // never lands and react-hook-form drops the field on the next render. The
  // three selects are held explicitly instead.
  const setScheduleType = (value: string) =>
    setValue("scheduleType", value as FormValues["scheduleType"], {
      shouldDirty: true,
    });
  const setDisplayMode = (value: string) =>
    setValue("displayMode", value as FormValues["displayMode"], {
      shouldDirty: true,
    });
  const setProgressFill = (value: string) =>
    setValue("progressFill", value as FormValues["progressFill"], {
      shouldDirty: true,
    });
  // Days are held as numbers, so a checkbox group cannot express them: react-hook-form
  // compares an input's string `value` against the stored array, and a number never
  // matches. The Signal weekday toggles used by Schedules keep the numeric form.
  const daysOfWeek = watch("daysOfWeek");
  const selectedDays = (daysOfWeek ?? []).map(Number);
  const toggleDay = (day: number) => {
    const next = selectedDays.includes(day)
      ? selectedDays.filter((value) => value !== day)
      : [...selectedDays, day];
    setValue("daysOfWeek", next, {
      shouldDirty: true,
      shouldValidate: Boolean(errors.daysOfWeek),
    });
  };
  const targetSource =
    targetScope === "screens"
      ? {
          query: screens,
          noun: "screens",
          empty: "No screens are enrolled yet.",
        }
      : targetScope === "sync_groups"
        ? {
            query: groups,
            noun: "sync groups",
            empty: "No sync groups exist yet.",
          }
        : targetScope === "locations"
          ? {
              query: locations,
              noun: "locations",
              empty: "No locations exist yet.",
            }
          : null;
  const targets = (targetSource?.query.data?.items ?? []).map((item) => ({
    id: item.id,
    name: item.name,
  }));
  const chosenTargets = watch("targetIds") ?? [];
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
      progressFill: values.progressFill,
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
        <Panel className="plugin-form__section">
          <SectionHeader title="Content" />
          <FormField
            id="countdown-name"
            label="Name"
            aria-required="true"
            error={errors.name?.message}
            {...register("name")}
          />
          <FormField
            id="countdown-message"
            label="Message"
            aria-required="true"
            error={errors.message?.message}
            {...register("message")}
          />
          <FormField
            id="countdown-completion"
            label="Optional completion text"
            placeholder="Lunch is over"
            hint="Shown for one minute after the target; leave blank to hide at zero."
            error={errors.completionText?.message}
            {...register("completionText")}
          />
        </Panel>

        <Panel className="plugin-form__section">
          <SectionHeader title="Timing" />
          <Field label="Schedule">
            <Select
              name="scheduleType"
              value={scheduleType}
              onChange={(event) => setScheduleType(event.target.value)}
            >
              <option value="weekly">Days of the week</option>
              <option value="one_time">One-time date</option>
            </Select>
          </Field>
          {scheduleType === "weekly" ? (
            <>
              <FormField
                id="countdown-target-time"
                label="Target time"
                type="time"
                error={errors.targetTime?.message}
                {...register("targetTime")}
              />
              <div className="plugin-field-group">
                <span className="field__label" id="countdown-days-label">
                  Days of the week
                </span>
                <div
                  className="countdown-weekdays"
                  role="group"
                  aria-labelledby="countdown-days-label"
                >
                  {scheduleWeekdays.map((day) => (
                    <button
                      type="button"
                      key={day.value}
                      aria-pressed={selectedDays.includes(day.value)}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.short}
                    </button>
                  ))}
                </div>
                {errors.daysOfWeek && (
                  <span className="field__error">
                    {errors.daysOfWeek.message}
                  </span>
                )}
              </div>
            </>
          ) : (
            <FormField
              id="countdown-one-time"
              label="Target date and time"
              type="datetime-local"
              hint="Entered in this browser's local time; the Player counts down to the same instant."
              error={errors.oneTimeAt?.message}
              {...register("oneTimeAt")}
            />
          )}
          <div className="plugin-form__row">
            <FormField
              id="countdown-timezone"
              label="Timezone"
              aria-required="true"
              error={errors.timezone?.message}
              {...register("timezone")}
            />
            <FormField
              id="countdown-lead"
              label="Appear this many minutes before"
              type="number"
              min={1}
              max={43_200}
              error={errors.leadMinutes?.message}
              {...register("leadMinutes", { valueAsNumber: true })}
            />
          </div>
        </Panel>

        <Panel className="plugin-form__section">
          <SectionHeader title="Display" />
          <div className="plugin-form__row">
            <Field label="Mode">
              <Select
                name="displayMode"
                value={displayMode}
                onChange={(event) => setDisplayMode(event.target.value)}
              >
                <option value="overlay">Overlay current content</option>
                <option value="push">Push and shrink current content</option>
              </Select>
            </Field>
            <Field
              label="Background countdown"
              description="Drain empties the bar from right to left as the target approaches."
            >
              <Select
                name="progressFill"
                // The Field description joins the wrapping label's text, so the
                // control names itself rather than inheriting label + hint.
                aria-label="Background countdown"
                value={progressFill}
                onChange={(event) => setProgressFill(event.target.value)}
              >
                <option value="none">Plain background</option>
                <option value="drain">Drain right to left</option>
              </Select>
            </Field>
            <FormField
              id="countdown-height"
              label="Bottom-bar height (px)"
              type="number"
              min={40}
              max={320}
              error={errors.heightPx?.message}
              {...register("heightPx", { valueAsNumber: true })}
            />
            <FormField
              id="countdown-priority"
              label="Priority"
              type="number"
              min={-1000}
              max={1000}
              error={errors.priority?.message}
              {...register("priority", { valueAsNumber: true })}
            />
          </div>
          <Checkbox label="Enabled" {...register("enabled")} />
        </Panel>

        <Panel className="plugin-form__section">
          <SectionHeader title="Targets" />
          <Field label="Target type">
            <Select
              name="targetScope"
              value={targetScope}
              onChange={(event) => {
                // Ids from the previous scope would otherwise stay registered
                // and be submitted alongside the new scope's picks.
                setValue("targetIds", []);
                setValue(
                  "targetScope",
                  event.target.value as FormValues["targetScope"],
                  { shouldDirty: true },
                );
              }}
            >
              <option value="all">All screens</option>
              <option value="screens">Individual screens</option>
              <option value="sync_groups">Sync groups</option>
              <option value="locations">Locations</option>
            </Select>
          </Field>
          {targetSource && (
            <div className="plugin-field-group">
              <span className="field__label" id="countdown-targets-label">
                Choose targets
              </span>
              <div
                className="countdown-targets"
                role="group"
                aria-labelledby="countdown-targets-label"
              >
                <div className="countdown-targets__header">
                  <span>Available {targetSource.noun}</span>
                  <span>
                    {chosenTargets.length} of {targets.length} selected
                  </span>
                </div>
                <div className="countdown-targets__list">
                  {targets.map((target) => (
                    <label className="countdown-target" key={target.id}>
                      <input
                        type="checkbox"
                        value={target.id}
                        {...register("targetIds")}
                      />
                      <span>{target.name}</span>
                    </label>
                  ))}
                  {!targets.length && (
                    <p className="countdown-targets__note">
                      {targetSource.query.isLoading
                        ? `Loading ${targetSource.noun}…`
                        : targetSource.query.isError
                          ? `The ${targetSource.noun} could not be loaded.`
                          : targetSource.empty}
                    </p>
                  )}
                </div>
              </div>
              {errors.targetIds && (
                <span className="field__error">{errors.targetIds.message}</span>
              )}
            </div>
          )}
        </Panel>

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
