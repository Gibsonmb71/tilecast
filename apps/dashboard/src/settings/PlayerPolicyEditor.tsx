import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SettingDefinition } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { SettingControl } from "./SettingControl";
import { descriptionFor } from "./settingDisplay";

const policyGroups = [
  ["Playback defaults", ["player.playback."]],
  ["Storage and delivery", ["player.cache.", "player.download."]],
  [
    "Synchronization and diagnostics",
    ["player.sync.", "player.identify.", "player.diagnostics."],
  ],
  ["Reliability and kiosk", ["reliability.", "managed_kiosk."]],
  ["Active hours and power", ["power."]],
  ["Accessibility control", ["accessibility."]],
  ["Website behavior", ["player.website."]],
] as const;

export function PlayerPolicyEditor({
  target,
  id,
}: {
  target: "group" | "screen";
  id: string;
}) {
  const auth = useAuth();
  const manageable = ["owner", "administrator"].includes(
    auth.status?.user?.role ?? "",
  );
  const settings = useQuery({
    queryKey: ["settings", "policy-definitions"],
    queryFn: api.settings,
  });
  const policy = useQuery({
    queryKey: [target, id, "policy"],
    queryFn: () =>
      target === "group" ? api.groupPolicy(id) : api.screenPolicy(id),
  });
  const effective = useQuery({
    queryKey: ["screens", id, "effective-policy"],
    queryFn: () => api.effectivePolicy(id),
    enabled: target === "screen",
  });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [priority, setPriority] = useState(0);
  const [filter, setFilter] = useState<"all" | "overridden">("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(policyGroups.map(([title]) => title)),
  );
  useEffect(() => {
    if (policy.data) {
      setValues(policy.data.values);
      setPriority(policy.data.priority ?? 0);
    }
  }, [policy.data]);
  const save = useMutation({
    mutationFn: () =>
      target === "group"
        ? api.putGroupPolicy(
            id,
            policy.data?.revision ?? 0,
            priority,
            values,
            auth.status?.csrfToken ?? "",
          )
        : api.putScreenPolicy(
            id,
            policy.data?.revision ?? 0,
            values,
            auth.status?.csrfToken ?? "",
          ),
    onSuccess: () => {
      void policy.refetch();
      void effective.refetch();
    },
  });
  const reset = useMutation({
    mutationFn: () =>
      target === "group"
        ? api.deleteGroupPolicy(id, auth.status?.csrfToken ?? "")
        : api.deleteScreenPolicy(id, auth.status?.csrfToken ?? ""),
    onSuccess: () => {
      setValues({});
      void policy.refetch();
      void effective.refetch();
    },
  });
  const definitions = (settings.data?.definitions ?? []).filter(
    (definition) => definition.scope === "policy",
  );
  const grouped = useMemo(
    () =>
      policyGroups
        .map(([title, prefixes]) => ({
          title,
          definitions: definitions.filter((definition) =>
            prefixes.some((prefix) => definition.key.startsWith(prefix)),
          ),
        }))
        .filter((group) => group.definitions.length),
    [definitions],
  );
  const overrideCount = Object.keys(values).length;
  const inheritedGroup =
    target === "screen"
      ? Object.values(effective.data?.values ?? {}).filter((item) =>
          item.source.startsWith("Group"),
        ).length
      : 0;
  return (
    <section className="detail-card policy-editor">
      <header className="policy-editor__heading">
        <div>
          <h3>Player policy</h3>
          <p>
            {target === "group"
              ? "Overrides organization defaults. A higher priority wins when a screen belongs to multiple groups."
              : "Screen overrides have the highest precedence."}
          </p>
        </div>
        <div className="policy-summary">
          <strong>{overrideCount} overrides</strong>
          <span>
            {Math.max(0, definitions.length - overrideCount - inheritedGroup)}{" "}
            inherited from organization
          </span>
          {target === "screen" && (
            <span>{inheritedGroup} inherited from groups</span>
          )}
        </div>
      </header>
      {target === "group" && (
        <label className="policy-priority">
          <span>
            <strong>Policy priority</strong>
            <small>
              Higher numbers take precedence when groups set the same value.
            </small>
          </span>
          <input
            type="number"
            min={-1000}
            max={1000}
            value={priority}
            disabled={!manageable}
            onChange={(event) => setPriority(Number(event.target.value))}
          />
        </label>
      )}
      <div className="policy-toolbar">
        <div className="segmented-control" aria-label="Policy filter">
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            Show all
          </button>
          <button
            type="button"
            aria-pressed={filter === "overridden"}
            onClick={() => setFilter("overridden")}
          >
            Overridden only
          </button>
        </div>
        <button
          type="button"
          className="button button--quiet"
          onClick={() =>
            setExpanded(
              expanded.size
                ? new Set()
                : new Set(grouped.map((group) => group.title)),
            )
          }
        >
          {expanded.size ? "Collapse sections" : "Expand sections"}
        </button>
      </div>
      <div className="policy-sections">
        {grouped.map((group) => {
          const items =
            filter === "overridden"
              ? group.definitions.filter((definition) =>
                  Object.hasOwn(values, definition.key),
                )
              : group.definitions;
          if (!items.length) return null;
          const open = expanded.has(group.title);
          return (
            <section key={group.title}>
              <button
                type="button"
                className="policy-section-toggle"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(group.title)) next.delete(group.title);
                    else next.add(group.title);
                    return next;
                  })
                }
              >
                <strong>{group.title}</strong>
                <span>
                  {
                    items.filter((item) => Object.hasOwn(values, item.key))
                      .length
                  }{" "}
                  overrides
                </span>
              </button>
              {open && (
                <div>
                  {items.map((definition) => (
                    <PolicyRow
                      key={definition.key}
                      definition={definition}
                      overridden={Object.hasOwn(values, definition.key)}
                      value={values[definition.key]}
                      inherited={
                        target === "screen"
                          ? effective.data?.values[definition.key]
                          : undefined
                      }
                      organizationValue={
                        settings.data?.values[definition.key] ??
                        definition.default
                      }
                      manageable={manageable}
                      overrideSource={
                        target === "group"
                          ? "Group override"
                          : "Screen override"
                      }
                      onToggle={(enabled) => {
                        const next = { ...values };
                        if (enabled)
                          next[definition.key] =
                            (target === "screen"
                              ? effective.data?.values[definition.key]?.value
                              : undefined) ??
                            settings.data?.values[definition.key] ??
                            definition.default;
                        else delete next[definition.key];
                        setValues(next);
                      }}
                      onChange={(value) =>
                        setValues({ ...values, [definition.key]: value })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {effective.data && (
        <p className="policy-revision">
          Effective configuration revision {effective.data.configRevision} ·{" "}
          {effective.data.hash.slice(0, 12)}
        </p>
      )}
      {manageable && (
        <div className="settings-actions settings-actions--separated">
          <button
            className="button button--danger-quiet"
            disabled={!overrideCount || reset.isPending}
            onClick={() => {
              if (confirm("Reset all player policy overrides?")) reset.mutate();
            }}
          >
            Reset all overrides
          </button>
          <button
            className="button button--primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save policy"}
          </button>
        </div>
      )}
    </section>
  );
}

function PolicyRow({
  definition,
  overridden,
  value,
  inherited,
  organizationValue,
  manageable,
  overrideSource,
  onToggle,
  onChange,
}: {
  definition: SettingDefinition;
  overridden: boolean;
  value: unknown;
  inherited?: { value: unknown; source: string };
  organizationValue: unknown;
  manageable: boolean;
  overrideSource: string;
  onToggle: (enabled: boolean) => void;
  onChange: (value: unknown) => void;
}) {
  const inheritedValue = inherited?.value ?? organizationValue;
  const source = inherited?.source ?? "Organization default";
  return (
    <div className="policy-row">
      <div className="policy-row__summary">
        <div>
          <strong>{definition.title}</strong>
          <small>{descriptionFor(definition)}</small>
          <span className="source-badge">
            {overridden ? overrideSource : source}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={overridden}
          className="setting-switch"
          disabled={!manageable}
          onClick={() => onToggle(!overridden)}
        >
          <span />
          <strong>{overridden ? "Override on" : "Override"}</strong>
        </button>
      </div>
      {overridden ? (
        <div className="policy-row__control">
          <SettingControl
            definition={definition}
            value={value ?? definition.default}
            disabled={!manageable}
            onChange={onChange}
          />
        </div>
      ) : (
        <p className="policy-inherited">
          Inherited value: <strong>{formatValue(inheritedValue)}</strong>
        </p>
      )}
    </div>
  );
}
function formatValue(value: unknown) {
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (typeof value === "boolean") return value ? "On" : "Off";
  return String(value);
}
