import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Search } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { OverviewTab } from "./ActivityOverviewPanel";
import { AuditTab, EventsTab, ProofTab } from "./ActivityReportTabs";
import "./ActivityPage.css";

type ActivityTab = "overview" | "proof" | "events" | "audit";

export function ActivityPage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = normalizeTab(searchParams.get("tab"));
  const [preset, setPreset] = useState("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [screen, setScreen] = useState(() => searchParams.get("screen") ?? "");
  const [group, setGroup] = useState("");
  const [result, setResult] = useState("");
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [media, setMedia] = useState("");
  const [widget, setWidget] = useState("");
  const [playlist, setPlaylist] = useState("");
  const [layout, setLayout] = useState("");
  const [schedule, setSchedule] = useState("");
  const [emergency, setEmergency] = useState("");
  const [summaryDimension, setSummaryDimension] = useState("screen");
  const range = useMemo(
    () => dateRange(preset, customFrom, customTo),
    [customFrom, customTo, preset],
  );
  const canExport = ["owner", "administrator"].includes(
    auth.status?.user?.role ?? "",
  );
  const screens = useQuery({
    queryKey: ["activity", "screens"],
    queryFn: api.screens,
  });
  const groups = useQuery({
    queryKey: ["activity", "groups"],
    queryFn: () => api.screenGroups(),
  });
  const users = useQuery({
    queryKey: ["activity", "users"],
    queryFn: api.users,
    enabled: ["owner", "administrator"].includes(auth.status?.user?.role ?? ""),
  });
  const filters = { search, screen, group, result };
  const proofFilters = {
    ...filters,
    media,
    widget,
    playlist,
    layout,
    schedule,
    emergency,
  };

  return (
    <section className="activity-page">
      <header className="page-heading activity-heading">
        <div>
          <h2>Activity</h2>
          <p>
            Operational reporting, Player-confirmed proof of play, technical
            screen events, and administrator history.
          </p>
        </div>
        <div className="activity-range">
          <label>
            <span>Date range</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          {preset === "custom" && (
            <>
              <label>
                <span>From</span>
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </label>
            </>
          )}
        </div>
      </header>

      <nav className="activity-tabs" aria-label="Activity reports">
        {(
          [
            ["overview", "Overview"],
            ["proof", "Proof of Play"],
            ...(["owner", "administrator"].includes(
              auth.status?.user?.role ?? "",
            )
              ? ([
                  ["events", "Screen Events"],
                  ["audit", "Audit Log"],
                ] as const)
              : auth.status?.user?.role === "editor"
                ? ([["audit", "Audit Log"]] as const)
                : []),
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-current={tab === value ? "page" : undefined}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (value === "overview") next.delete("tab");
              else next.set("tab", value);
              setSearchParams(next);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab !== "overview" && (
        <div className="activity-filters">
          <label className="activity-search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">Search activity</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity"
            />
          </label>
          {(tab === "proof" || tab === "events") && (
            <>
              <select
                aria-label="Filter by screen"
                value={screen}
                onChange={(e) => setScreen(e.target.value)}
              >
                <option value="">All screens</option>
                {screens.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">All groups</option>
                {groups.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {tab === "proof" && (
            <>
              <input value={media} onChange={(e) => setMedia(e.target.value)} placeholder="Media ID" aria-label="Filter by Media" />
              <input value={widget} onChange={(e) => setWidget(e.target.value)} placeholder="Widget ID" aria-label="Filter by Widget" />
              <input value={playlist} onChange={(e) => setPlaylist(e.target.value)} placeholder="Playlist ID" aria-label="Filter by Playlist" />
              <input value={layout} onChange={(e) => setLayout(e.target.value)} placeholder="Layout ID" aria-label="Filter by Layout" />
              <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="Schedule ID" aria-label="Filter by Schedule" />
              <input value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="Emergency ID" aria-label="Filter by Emergency" />
            </>
          )}
          {tab === "events" && (
            <>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {["connectivity", "manifest", "playback", "scheduling", "commands", "reliability", "updates", "emergencies"].map((value) => <option key={value}>{value}</option>)}
              </select>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">All severities</option>
                {["info", "warning", "error", "critical"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </>
          )}
          {tab === "audit" && (
            <>
              {users.data && (
                <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Filter by actor">
                  <option value="">All actors</option>
                  {users.data.items.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              )}
              <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action" aria-label="Filter by action" />
              <input value={resourceType} onChange={(e) => setResourceType(e.target.value)} placeholder="Resource type" aria-label="Filter by resource type" />
            </>
          )}
          <select value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">All results</option>
            {(tab === "audit" ? ["success", "failure", "denied", "partial"] : ["playing", "completed", "partial", "skipped", "failed", "unknown", "recovered"]).map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
      )}

      {tab === "overview" && <OverviewTab range={range} canManageRetention={["owner", "administrator"].includes(auth.status?.user?.role ?? "")} csrfToken={auth.status?.csrfToken ?? ""} />}
      {tab === "proof" && <ProofTab range={range} filters={proofFilters} canExport={canExport} dimension={summaryDimension} setDimension={setSummaryDimension} />}
      {tab === "events" && <EventsTab range={range} filters={{ ...filters, category, severity }} />}
      {tab === "audit" && <AuditTab range={range} filters={{ search, result, action, resourceType, actor }} canExport={canExport} />}
    </section>
  );
}

function normalizeTab(value: string | null): ActivityTab {
  return value === "proof" || value === "events" || value === "audit" ? value : "overview";
}

function dateRange(preset: string, customFrom: string, customTo: string) {
  const to = preset === "custom" && customTo ? new Date(customTo) : new Date();
  const from = preset === "custom" && customFrom ? new Date(customFrom) : new Date(to.getTime() - (preset === "30d" ? 30 : preset === "7d" ? 7 : 1) * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
