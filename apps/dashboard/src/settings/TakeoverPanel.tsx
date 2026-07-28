import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { api, ApiError } from "../api/client";
import type { NWSAlertRule, NWSAlertRuleInput, Playlist } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

const emptyRule: NWSAlertRuleInput = {
  name: "",
  enabled: true,
  eventNames: ["Tornado Warning"],
  minimumSeverity: "Severe",
  minimumUrgency: "Expected",
  playlistId: undefined,
  maximumDurationMinutes: 360,
  screenIds: [],
  groupIds: [],
};

const ruleSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a rule name.").max(180),
    enabled: z.boolean(),
    eventNames: z.array(z.string()),
    minimumSeverity: z.enum(["Minor", "Moderate", "Severe", "Extreme"]),
    minimumUrgency: z.enum(["Unknown", "Future", "Expected", "Immediate"]),
    playlistId: z.string().optional(),
    maximumDurationMinutes: z.number(),
    screenIds: z.array(z.string()),
    groupIds: z.array(z.string()),
  })
  .superRefine((value, context) => {
    if (!value.playlistId) {
      context.addIssue({
        code: "custom",
        path: ["playlistId"],
        message: "Select a pre-made emergency playlist.",
      });
    }
    if (value.screenIds.length + value.groupIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["screenIds"],
        message: "Select at least one screen or group.",
      });
    }
  });

export function TakeoverPanel({ editable }: { editable: boolean }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["nws-alert-settings"],
    queryFn: api.nwsAlertSettings,
    refetchInterval: 30_000,
  });
  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const groups = useQuery({
    queryKey: ["screen-groups", "nws-alerts"],
    queryFn: () => api.screenGroups(),
  });
  const playlists = useQuery({
    queryKey: ["playlists", "nws-alerts"],
    queryFn: () => api.playlists(),
  });
  const [enabled, setEnabled] = useState(false);
  const [areas, setAreas] = useState("");
  const [zones, setZones] = useState("");
  const [pollInterval, setPollInterval] = useState(120);
  const [monitorInitialized, setMonitorInitialized] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [eventNamesText, setEventNamesText] = useState(
    emptyRule.eventNames.join(", "),
  );
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors: ruleErrors },
  } = useForm<NWSAlertRuleInput>({
    resolver: zodResolver(ruleSchema),
    defaultValues: emptyRule,
  });
  const rule = watch();
  useEffect(() => {
    if (!settings.data || monitorInitialized) return;
    setEnabled(settings.data.monitor.enabled);
    setAreas(settings.data.monitor.areas.join(", "));
    setZones(settings.data.monitor.zones.join(", "));
    setPollInterval(settings.data.monitor.pollIntervalSeconds);
    setMonitorInitialized(true);
  }, [settings.data, monitorInitialized]);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["nws-alert-settings"] });
  const saveMonitor = useMutation({
    mutationFn: () =>
      api.updateNWSAlertMonitor(
        {
          enabled,
          areas: codes(areas),
          zones: codes(zones),
          pollIntervalSeconds: pollInterval,
        },
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: refresh,
  });
  const poll = useMutation({
    mutationFn: () => api.pollNWSAlerts(auth.status?.csrfToken ?? ""),
    onSuccess: refresh,
  });
  const saveRule = useMutation({
    mutationFn: (input: NWSAlertRuleInput) =>
      editing
        ? api.updateNWSAlertRule(editing, input, auth.status?.csrfToken ?? "")
        : api.createNWSAlertRule(input, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      setEditing(undefined);
      reset(emptyRule);
      setEventNamesText(emptyRule.eventNames.join(", "));
      void refresh();
    },
  });
  const submitRule = handleSubmit((input) =>
    saveRule.mutate({ ...input, eventNames: labels(eventNamesText) }),
  );
  const removeRule = useMutation({
    mutationFn: (id: string) =>
      api.deleteNWSAlertRule(id, auth.status?.csrfToken ?? ""),
    onSuccess: refresh,
  });
  const monitor = settings.data?.monitor;
  return (
    <div className="settings-sections takeover-settings">
      <section className="settings-subsection">
        <header>
          <h3>Prepare emergency content first</h3>
          <p>
            Create a separate playlist for each response you may need, such as a
            tornado warning, flash flood, severe weather closure, or evacuation.
            Then connect that pre-made playlist to a weather event rule below.
          </p>
        </header>
        <div className="takeover-settings__actions">
          <Link className="button button--primary" to="/playlists">
            Manage emergency playlists
          </Link>
          <Link className="button button--quiet" to="/screens">
            Display an emergency manually
          </Link>
        </div>
      </section>

      <section className="settings-subsection">
        <header>
          <h3>Automated weather alerts</h3>
          <p>
            Monitor official active alerts for US states, territories, counties,
            and forecast zones. Matching rules display the pre-made emergency
            playlist you choose and restore normal playback when the alert
            clears.
          </p>
        </header>
        <div className="notice notice--info">
          <strong>
            Alert delivery is best-effort, not a life-safety system.
          </strong>
          <p>
            Keep local emergency procedures and Wireless Emergency Alerts in
            place. Studio shows poll health so upstream or network failures are
            visible.
          </p>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="nws-enabled">Automated NWS monitoring</label>
            <p>Disabled by default. A configured rule is required to act.</p>
          </div>
          <div className="setting-control">
            <input
              id="nws-enabled"
              type="checkbox"
              checked={enabled}
              disabled={!editable}
              onChange={(event) => setEnabled(event.target.checked)}
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="nws-areas">States and territories</label>
            <p>Comma-separated two-letter NWS area codes, such as OH, PA.</p>
          </div>
          <div className="setting-control">
            <input
              id="nws-areas"
              value={areas}
              disabled={!editable}
              onChange={(event) => setAreas(event.target.value)}
              placeholder="OH, PA"
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="nws-zones">Counties or forecast zones</label>
            <p>Comma-separated six-character NWS zone codes, such as OHC049.</p>
          </div>
          <div className="setting-control">
            <input
              id="nws-zones"
              value={zones}
              disabled={!editable}
              onChange={(event) => setZones(event.target.value)}
              placeholder="OHC049"
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-copy">
            <label htmlFor="nws-interval">Poll interval</label>
            <p>A one- to two-minute interval is recommended for most sites.</p>
          </div>
          <div className="setting-control">
            <select
              id="nws-interval"
              value={pollInterval}
              disabled={!editable}
              onChange={(event) => setPollInterval(Number(event.target.value))}
            >
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={300}>5 minutes</option>
              <option value={900}>15 minutes</option>
            </select>
          </div>
        </div>
        <div className="takeover-settings__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={!editable || saveMonitor.isPending}
            onClick={() => saveMonitor.mutate()}
          >
            {saveMonitor.isPending ? "Saving…" : "Save NWS monitor"}
          </button>
          <button
            type="button"
            className="button button--quiet"
            disabled={!editable || poll.isPending}
            onClick={() => poll.mutate()}
          >
            {poll.isPending ? "Checking…" : "Check now"}
          </button>
        </div>
        {errorText(saveMonitor.error ?? poll.error) && (
          <p className="form-error" role="alert">
            {errorText(saveMonitor.error ?? poll.error)}
          </p>
        )}
        {monitor && (
          <dl className="takeover-settings__health">
            <div>
              <dt>Last success</dt>
              <dd>{dateText(monitor.lastSuccessAt)}</dd>
            </div>
            <div>
              <dt>Last attempt</dt>
              <dd>{dateText(monitor.lastPolledAt)}</dd>
            </div>
            <div>
              <dt>Matched rules</dt>
              <dd>{monitor.lastMatchedCount}</dd>
            </div>
            <div>
              <dt>Health</dt>
              <dd>{monitor.lastErrorCode || "Healthy"}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="settings-subsection">
        <header>
          <h3>Weather event rules</h3>
          <p>
            Event names match NWS wording exactly. Leave the field empty to
            match every event at or above the selected severity and urgency.
            Each rule can display a different custom playlist.
          </p>
        </header>
        <div className="takeover-rule-list">
          {(settings.data?.rules ?? []).map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.eventNames.join(", ") || "All event types"} ·{" "}
                  {item.minimumSeverity}+ · {item.playlistName || "No playlist"}
                </p>
              </div>
              <div>
                <span>{item.enabled ? "Enabled" : "Disabled"}</span>
                {editable && (
                  <>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => {
                        setEditing(item.id);
                        const input = toInput(item);
                        reset(input);
                        setEventNamesText(input.eventNames.join(", "));
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="button button--quiet"
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete “${item.name}”?`))
                          removeRule.mutate(item.id);
                      }}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
        {editable && (
          <form
            className="takeover-rule-editor"
            onSubmit={(event) => void submitRule(event)}
          >
            <h4>{editing ? "Edit rule" : "Add rule"}</h4>
            <label>
              Rule name
              <input maxLength={180} {...register("name")} />
            </label>
            {ruleErrors.name && (
              <p className="form-error" role="alert">
                {ruleErrors.name.message}
              </p>
            )}
            <label>
              NWS event names
              <input
                value={eventNamesText}
                placeholder="Tornado Warning, Flash Flood Warning"
                onChange={(event) => setEventNamesText(event.target.value)}
              />
            </label>
            <div className="takeover-rule-editor__columns">
              <label>
                Minimum severity
                <select {...register("minimumSeverity")}>
                  {["Minor", "Moderate", "Severe", "Extreme"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Minimum urgency
                <select {...register("minimumUrgency")}>
                  {["Unknown", "Future", "Expected", "Immediate"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Pre-made emergency playlist
                <select {...register("playlistId")}>
                  <option value="">Select a playlist</option>
                  {playlists.data?.items.map((item) => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={item.itemCount === 0}
                    >
                      {emergencyPlaylistLabel(item)}
                    </option>
                  ))}
                </select>
                <small>
                  Only non-empty playlists can be activated.{" "}
                  <Link to="/playlists">Create or edit playlists</Link>
                </small>
                {ruleErrors.playlistId && (
                  <span className="form-error" role="alert">
                    {ruleErrors.playlistId.message}
                  </span>
                )}
              </label>
              <label>
                Maximum duration
                <select
                  {...register("maximumDurationMinutes", {
                    valueAsNumber: true,
                  })}
                >
                  <option value={60}>1 hour</option>
                  <option value={360}>6 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>24 hours</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Target screens</legend>
              <div className="takeover-rule-editor__targets">
                {screens.data?.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={rule.screenIds.includes(item.id)}
                      onChange={() =>
                        setValue("screenIds", toggle(rule.screenIds, item.id), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
            {ruleErrors.screenIds && (
              <p className="form-error" role="alert">
                {ruleErrors.screenIds.message}
              </p>
            )}
            <fieldset>
              <legend>Target groups</legend>
              <div className="takeover-rule-editor__targets">
                {groups.data?.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={rule.groupIds.includes(item.id)}
                      onChange={() =>
                        setValue("groupIds", toggle(rule.groupIds, item.id), {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="checkbox-control">
              <input type="checkbox" {...register("enabled")} />
              Enable this rule
            </label>
            <div className="takeover-settings__actions">
              <button
                className="button button--primary"
                type="submit"
                disabled={saveRule.isPending}
              >
                {saveRule.isPending
                  ? "Saving…"
                  : editing
                    ? "Save rule"
                    : "Add rule"}
              </button>
              {editing && (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => {
                    setEditing(undefined);
                    reset(emptyRule);
                    setEventNamesText(emptyRule.eventNames.join(", "));
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {errorText(saveRule.error) && (
              <p className="form-error" role="alert">
                {errorText(saveRule.error)}
              </p>
            )}
          </form>
        )}
      </section>

      <section className="settings-subsection">
        <header>
          <h3>Active weather emergencies</h3>
          <p>Alerts currently matched to a rule and displaying content.</p>
        </header>
        {(settings.data?.activeAlerts.length ?? 0) === 0 ? (
          <p className="empty-state">No NWS alerts are currently active.</p>
        ) : (
          <div className="takeover-rule-list">
            {settings.data?.activeAlerts.map((item) => (
              <article key={`${item.alertId}:${item.ruleId}`}>
                <div>
                  <strong>{item.event}</strong>
                  <p>{item.headline || item.areaDescription}</p>
                </div>
                <span>{item.severity}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const codes = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
const labels = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const toggle = (items: string[], value: string) =>
  items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
const dateText = (value?: string) =>
  value ? new Date(value).toLocaleString() : "Never";
const errorText = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : "";
export const emergencyPlaylistLabel = (
  playlist: Pick<Playlist, "name" | "itemCount">,
) =>
  playlist.itemCount === 0
    ? `${playlist.name} — empty, add content first`
    : `${playlist.name} — ${playlist.itemCount} item${playlist.itemCount === 1 ? "" : "s"}`;
const toInput = (rule: NWSAlertRule): NWSAlertRuleInput => ({
  name: rule.name,
  enabled: rule.enabled,
  eventNames: rule.eventNames,
  minimumSeverity: rule.minimumSeverity,
  minimumUrgency: rule.minimumUrgency,
  playlistId: rule.playlistId,
  maximumDurationMinutes: rule.maximumDurationMinutes,
  screenIds: rule.screenIds,
  groupIds: rule.groupIds,
});
