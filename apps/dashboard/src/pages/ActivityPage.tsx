import { PageHeader, Select, ViewTabs } from "../components/ui";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Download, SlidersHorizontal, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { DashboardSearch } from "../components/DashboardListToolbar";
import { OverviewTab } from "./ActivityOverviewPanel";
import { AuditTab, EventsTab, ProofTab } from "./ActivityReportTabs";
import { activityParams } from "./ActivityShared";
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
  const auditFilters = { search, result, action, resourceType, actor };
  const advancedProofFilters = [
    { key: "media", label: "Media", value: media, setValue: setMedia },
    { key: "widget", label: "Widget", value: widget, setValue: setWidget },
    {
      key: "playlist",
      label: "Playlist",
      value: playlist,
      setValue: setPlaylist,
    },
    { key: "layout", label: "Layout", value: layout, setValue: setLayout },
    {
      key: "schedule",
      label: "Schedule",
      value: schedule,
      setValue: setSchedule,
    },
    {
      key: "emergency",
      label: "Emergency",
      value: emergency,
      setValue: setEmergency,
    },
  ];
  const activeAdvancedFilters = advancedProofFilters.filter(
    (filter) => filter.value,
  );
  const hasActiveProofFilters = Object.values(proofFilters).some(Boolean);
  const exportHref =
    canExport && tab === "proof"
      ? `/api/v1/activity/proof-of-play/export.csv?${activityParams(range, proofFilters)}`
      : canExport && tab === "audit"
        ? `/api/v1/activity/audit/export.csv?${activityParams(range, auditFilters)}`
        : undefined;
  const activityTabs = [
    { value: "overview" as const, label: "Overview" },
    { value: "proof" as const, label: "Proof of Play" },
    ...(["owner", "administrator"].includes(auth.status?.user?.role ?? "")
      ? [
          { value: "events" as const, label: "Screen Events" },
          { value: "audit" as const, label: "Audit Log" },
        ]
      : auth.status?.user?.role === "editor"
        ? [{ value: "audit" as const, label: "Audit Log" }]
        : []),
  ];

  function selectTab(value: ActivityTab) {
    const next = new URLSearchParams(searchParams);
    if (value === "overview") next.delete("tab");
    else next.set("tab", value);
    setSearchParams(next);
  }

  function clearAdvancedProofFilters() {
    setMedia("");
    setWidget("");
    setPlaylist("");
    setLayout("");
    setSchedule("");
    setEmergency("");
  }

  function clearProofFilters() {
    setSearch("");
    setScreen("");
    setGroup("");
    setResult("");
    clearAdvancedProofFilters();
  }

  return (
    <section className="activity-page">
      <PageHeader
        className="activity-heading"
        title="Activity"
        description="Operational reporting, Player-confirmed proof of play, technical screen events, and administrator history."
        actions={
          <div className="activity-heading-actions">
            <div className="activity-range">
              <label>
                <span>Date range</span>
                <Select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                >
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </Select>
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
            {exportHref && (
              <a
                className="button button--secondary activity-export"
                href={exportHref}
                title="Export the current date range and filters"
              >
                <Download size={15} /> Export CSV
              </a>
            )}
          </div>
        }
      />

      <ViewTabs
        className="activity-tabs"
        label="Activity reports"
        value={tab}
        items={activityTabs}
        onValueChange={selectTab}
      />

      {tab !== "overview" && (
        <div className="activity-filter-area">
          <div className="activity-filters">
            <DashboardSearch
              value={search}
              onValueChange={setSearch}
              label="Search activity"
              placeholder={
                tab === "proof"
                  ? "Search proof of play…"
                  : tab === "events"
                    ? "Search screen events…"
                    : "Search audit log…"
              }
            />
            {(tab === "proof" || tab === "events") && (
              <>
                <Select
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
                </Select>
                <Select
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
                </Select>
              </>
            )}
            {tab === "proof" && (
              <>
                <ResultFilter value={result} onChange={setResult} />
                <details className="activity-more-filters">
                  <summary>
                    <SlidersHorizontal size={15} />
                    <span>More filters</span>
                    {activeAdvancedFilters.length > 0 && (
                      <span className="activity-filter-count">
                        {activeAdvancedFilters.length}
                      </span>
                    )}
                  </summary>
                  <div className="activity-more-filters-panel">
                    <header>
                      <span>
                        <strong>Advanced filters</strong>
                        <small>Filter by an exact resource ID.</small>
                      </span>
                      {activeAdvancedFilters.length > 0 && (
                        <button
                          type="button"
                          className="button button--quiet button--compact"
                          onClick={clearAdvancedProofFilters}
                        >
                          Clear
                        </button>
                      )}
                    </header>
                    <div className="activity-advanced-filter-grid">
                      {advancedProofFilters.map((filter) => (
                        <label key={filter.key}>
                          <span>{filter.label} ID</span>
                          <input
                            value={filter.value}
                            onChange={(e) => filter.setValue(e.target.value)}
                            placeholder={`${filter.label} ID`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </details>
              </>
            )}
            {tab === "events" && (
              <>
                <Select
                  aria-label="Filter by category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">All categories</option>
                  {[
                    "connectivity",
                    "manifest",
                    "playback",
                    "scheduling",
                    "commands",
                    "reliability",
                    "updates",
                    "emergencies",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  <option value="">All severities</option>
                  {["info", "warning", "error", "critical"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
                <ResultFilter value={result} onChange={setResult} />
              </>
            )}
            {tab === "audit" && (
              <>
                {users.data && (
                  <Select
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    aria-label="Filter by actor"
                  >
                    <option value="">All actors</option>
                    {users.data.items.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </Select>
                )}
                <input
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  placeholder="Action"
                  aria-label="Filter by action"
                />
                <input
                  value={resourceType}
                  onChange={(e) => setResourceType(e.target.value)}
                  placeholder="Resource type"
                  aria-label="Filter by resource type"
                />
                <Select
                  aria-label="Filter by result"
                  value={result}
                  onChange={(e) => setResult(e.target.value)}
                >
                  <option value="">All results</option>
                  {["success", "failure", "denied", "partial"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </>
            )}
          </div>
          {tab === "proof" && activeAdvancedFilters.length > 0 && (
            <div className="activity-filter-chips" aria-label="Active filters">
              {activeAdvancedFilters.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => filter.setValue("")}
                  title={`Remove ${filter.label} filter`}
                >
                  <strong>{filter.label}:</strong>
                  <span>{filter.value}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              ))}
              <button
                type="button"
                className="activity-clear-filters"
                onClick={clearAdvancedProofFilters}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "overview" && (
        <OverviewTab
          range={range}
          canManageRetention={["owner", "administrator"].includes(
            auth.status?.user?.role ?? "",
          )}
          csrfToken={auth.status?.csrfToken ?? ""}
        />
      )}
      {tab === "proof" && (
        <ProofTab
          range={range}
          filters={proofFilters}
          dimension={summaryDimension}
          setDimension={setSummaryDimension}
          hasActiveFilters={hasActiveProofFilters}
          canExtendRange={preset === "24h"}
          onClearFilters={clearProofFilters}
          onExtendRange={() => setPreset("7d")}
          onViewScreenEvents={() => selectTab("events")}
        />
      )}
      {tab === "events" && (
        <EventsTab range={range} filters={{ ...filters, category, severity }} />
      )}
      {tab === "audit" && <AuditTab range={range} filters={auditFilters} />}
    </section>
  );
}

function ResultFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label="Filter by result"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All results</option>
      {[
        "playing",
        "completed",
        "partial",
        "skipped",
        "failed",
        "unknown",
        "recovered",
      ].map((option) => (
        <option key={option}>{option}</option>
      ))}
    </Select>
  );
}

function normalizeTab(value: string | null): ActivityTab {
  return value === "proof" || value === "events" || value === "audit"
    ? value
    : "overview";
}

function dateRange(preset: string, customFrom: string, customTo: string) {
  const to = preset === "custom" && customTo ? new Date(customTo) : new Date();
  const from =
    preset === "custom" && customFrom
      ? new Date(customFrom)
      : new Date(
          to.getTime() -
            (preset === "30d" ? 30 : preset === "7d" ? 7 : 1) * 86_400_000,
        );
  return { from: from.toISOString(), to: to.toISOString() };
}
