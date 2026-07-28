import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import type { NWSAlertRule, NWSAlertRuleInput } from "../api/types";
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
  const [interval, setInterval] = useState(120);
  const [monitorInitialized, setMonitorInitialized] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [rule, setRule] = useState<NWSAlertRuleInput>(emptyRule);
  useEffect(() => {
    if (!settings.data || monitorInitialized) return;
    setEnabled(settings.data.monitor.enabled);
    setAreas(settings.data.monitor.areas.join(", "));
    setZones(settings.data.monitor.zones.join(", "));
    setInterval(settings.data.monitor.pollIntervalSeconds);
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
          pollIntervalSeconds: interval,
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
    mutationFn: () =>
      editing
        ? api.updateNWSAlertRule(editing, rule, auth.status?.csrfToken ?? "")
        : api.createNWSAlertRule(rule, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      setEditing(undefined);
      setRule(emptyRule);
      void refresh();
    },
  });
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
          <h3>National Weather Service alerts</h3>
          <p>
            Monitor official active alerts for US states, territories, counties,
            and forecast zones. Matching rules raise a bounded Takeover and
            restore normal playback when the alert clears.
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
            <p>NWS recommends no more than one request every 30 seconds.</p>
          </div>
          <div className="setting-control">
            <select
              id="nws-interval"
              value={interval}
              disabled={!editable}
              onChange={(event) => setInterval(Number(event.target.value))}
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
          <h3>Automatic Takeover rules</h3>
          <p>
            Event names match NWS wording exactly. Leave the field empty to
            match every event at or above the selected severity and urgency.
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
                        setRule(toInput(item));
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
          <div className="takeover-rule-editor">
            <h4>{editing ? "Edit rule" : "Add rule"}</h4>
            <label>
              Rule name
              <input
                value={rule.name}
                maxLength={180}
                onChange={(event) =>
                  setRule({ ...rule, name: event.target.value })
                }
              />
            </label>
            <label>
              NWS event names
              <input
                value={rule.eventNames.join(", ")}
                placeholder="Tornado Warning, Flash Flood Warning"
                onChange={(event) =>
                  setRule({ ...rule, eventNames: labels(event.target.value) })
                }
              />
            </label>
            <div className="takeover-rule-editor__columns">
              <label>
                Minimum severity
                <select
                  value={rule.minimumSeverity}
                  onChange={(event) =>
                    setRule({
                      ...rule,
                      minimumSeverity: event.target
                        .value as NWSAlertRuleInput["minimumSeverity"],
                    })
                  }
                >
                  {["Minor", "Moderate", "Severe", "Extreme"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Minimum urgency
                <select
                  value={rule.minimumUrgency}
                  onChange={(event) =>
                    setRule({
                      ...rule,
                      minimumUrgency: event.target
                        .value as NWSAlertRuleInput["minimumUrgency"],
                    })
                  }
                >
                  {["Unknown", "Future", "Expected", "Immediate"].map(
                    (value) => (
                      <option key={value}>{value}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Takeover playlist
                <select
                  value={rule.playlistId ?? ""}
                  onChange={(event) =>
                    setRule({
                      ...rule,
                      playlistId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Select playlist</option>
                  {playlists.data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Maximum duration
                <select
                  value={rule.maximumDurationMinutes}
                  onChange={(event) =>
                    setRule({
                      ...rule,
                      maximumDurationMinutes: Number(event.target.value),
                    })
                  }
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
                        setRule({
                          ...rule,
                          screenIds: toggle(rule.screenIds, item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Target groups</legend>
              <div className="takeover-rule-editor__targets">
                {groups.data?.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={rule.groupIds.includes(item.id)}
                      onChange={() =>
                        setRule({
                          ...rule,
                          groupIds: toggle(rule.groupIds, item.id),
                        })
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="checkbox-control">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) =>
                  setRule({ ...rule, enabled: event.target.checked })
                }
              />
              Enable this rule
            </label>
            <div className="takeover-settings__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={
                  saveRule.isPending ||
                  !rule.name ||
                  !rule.playlistId ||
                  rule.screenIds.length + rule.groupIds.length === 0
                }
                onClick={() => saveRule.mutate()}
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
                    setRule(emptyRule);
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
          </div>
        )}
      </section>

      <section className="settings-subsection">
        <header>
          <h3>Active NWS alerts</h3>
          <p>
            Alerts currently matched to a rule and their generated Takeover.
          </p>
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
