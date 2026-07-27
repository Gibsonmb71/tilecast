import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ChevronRight,
  CircleAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { api } from "../api/client";
import type {
  UptimeBucket,
  UptimeReport,
  UptimeScreen,
  UptimeState,
  UptimeWindow,
} from "../api/types";
import "./FleetUptimePanel.css";

const windows: { key: UptimeWindow; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
];

const stateLabels: Record<UptimeState, string> = {
  up: "Up",
  impaired: "Impaired",
  down: "Down",
  unknown: "No data",
};

export function FleetUptimePanel({
  /**
   * Overrides the standing description. Surfaces that carry their own date
   * range use it to say that uptime is measured over its own fixed window.
   */
  description = "Measured player time spent connected and playing.",
}: {
  description?: string;
} = {}) {
  const [activeWindow, setActiveWindow] = useState<UptimeWindow>("24h");
  const query = useQuery({
    queryKey: ["fleet-uptime", activeWindow],
    queryFn: () => api.fleetUptime(activeWindow),
    refetchInterval: 60_000,
  });
  const report = query.data;

  return (
    <section className="uptime-panel" aria-labelledby="uptime-heading">
      <header>
        <div>
          <h3 id="uptime-heading">Uptime</h3>
          <p>{description}</p>
        </div>
        <div className="uptime-window" role="group" aria-label="Uptime window">
          {windows.map((option) => (
            <button
              key={option.key}
              type="button"
              className={
                option.key === activeWindow
                  ? "uptime-window__option uptime-window__option--active"
                  : "uptime-window__option"
              }
              aria-pressed={option.key === activeWindow}
              onClick={() => setActiveWindow(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {query.isLoading ? (
        <div className="uptime-empty">Loading uptime…</div>
      ) : query.isError ? (
        <div className="uptime-empty" role="alert">
          <CircleAlert size={20} aria-hidden="true" />
          <strong>Uptime could not be loaded</strong>
          <span>Refresh the page or check the Tilecast server connection.</span>
        </div>
      ) : !report || report.screensTracked === 0 ? (
        <div className="uptime-empty">
          <strong>No screens to measure</strong>
          <span>
            Uptime covers enabled screens.{" "}
            <Link to="/screens">Pair a screen</Link> to start recording state.
          </span>
        </div>
      ) : report.uptimePercent === null ? (
        <div className="uptime-empty">
          <strong>No player state recorded yet</strong>
          <span>
            Uptime appears once paired players report connection and playback
            state for this window.
          </span>
        </div>
      ) : (
        <UptimeBody report={report} />
      )}
    </section>
  );
}

function UptimeBody({ report }: { report: UptimeReport }) {
  const labelEvery = report.window === "24h" ? 6 : 4;
  return (
    <>
      <div className="uptime-figures">
        <div className="uptime-figures__headline">
          <strong>{formatPercent(report.uptimePercent)}</strong>
          <span>Up · {report.windowLabel.toLowerCase()}</span>
          <UptimeTrend report={report} />
        </div>
        <dl className="uptime-figures__list">
          <div>
            <dt>Down</dt>
            <dd>{formatSeconds(report.downSeconds)}</dd>
          </div>
          <div>
            <dt>Impaired</dt>
            <dd>{formatSeconds(report.impairedSeconds)}</dd>
          </div>
          <div>
            <dt>Screens with downtime</dt>
            <dd>
              {report.screensWithDowntime} of {report.screensTracked}
            </dd>
          </div>
        </dl>
      </div>

      <div
        className="uptime-chart"
        role="img"
        aria-label={chartDescription(report)}
      >
        <div className="uptime-chart__bars">
          {report.buckets.map((bucket) => (
            <div
              key={bucket.start}
              className="uptime-chart__column"
              title={bucketTitle(bucket, report.bucketSeconds)}
            >
              <Segment kind="unknown" percent={bucket.unknownPercent} />
              <Segment kind="down" percent={bucket.downPercent} />
              <Segment kind="impaired" percent={bucket.impairedPercent} />
              <Segment kind="up" percent={bucket.upPercent} />
            </div>
          ))}
        </div>
        <div className="uptime-chart__axis" aria-hidden="true">
          {report.buckets.map((bucket, index) => (
            <span key={bucket.start}>
              {index % labelEvery === 0
                ? formatAxis(bucket.start, report.window)
                : ""}
            </span>
          ))}
        </div>
      </div>

      {/* The per-screen strips are the tallest part of the panel, so the
          overview keeps them one click away rather than always on screen. */}
      <details className="uptime-screens">
        <summary>
          <span className="uptime-screens__summary">
            <ChevronRight
              className="uptime-screens__chevron"
              size={14}
              aria-hidden="true"
            />
            Per screen · {screenBreakdown(report)}
          </span>
          <ul className="uptime-legend">
            {(Object.keys(stateLabels) as UptimeState[]).map((state) => (
              <li key={state}>
                <span
                  className={`uptime-swatch uptime-swatch--${state}`}
                  aria-hidden="true"
                />
                {stateLabels[state]}
              </li>
            ))}
          </ul>
        </summary>
        <div className="uptime-screens__list">
          {report.screens.map((screen) => (
            <ScreenRow
              key={screen.screenId}
              screen={screen}
              bucketSeconds={report.bucketSeconds}
              buckets={report.buckets}
            />
          ))}
        </div>
        {report.screens.length < report.screensTracked && (
          <p className="uptime-screens__note">
            Showing the lowest {report.screens.length} of{" "}
            {report.screensTracked} screens.
          </p>
        )}
      </details>
    </>
  );
}

// Unmeasured screens are named rather than hidden: a player that has not
// reported state yet is a real gap in the graph, not a healthy screen.
function screenBreakdown(report: UptimeReport) {
  const parts = [`${report.screensTracked} screens`];
  parts.push(
    report.screensWithDowntime > 0
      ? `${report.screensWithDowntime} with downtime`
      : "none with downtime",
  );
  if (report.screensUnmeasured > 0) {
    parts.push(`${report.screensUnmeasured} not measured yet`);
  }
  return parts.join(" · ");
}

function ScreenRow({
  screen,
  buckets,
  bucketSeconds,
}: {
  screen: UptimeScreen;
  buckets: UptimeBucket[];
  bucketSeconds: number;
}) {
  return (
    <div className="uptime-screen">
      <Link to={`/screens/${screen.screenId}`}>{screen.screenName}</Link>
      <div
        className="uptime-strip"
        role="img"
        aria-label={`${screen.screenName}: ${formatPercent(screen.uptimePercent)} up${
          screen.downSeconds > 0
            ? `, ${formatSeconds(screen.downSeconds)} down`
            : ""
        }`}
      >
        {screen.buckets.map((state, index) => (
          <span
            key={buckets[index]?.start ?? index}
            className={`uptime-strip__cell uptime-strip__cell--${state}`}
            title={`${stateLabels[state]} · ${formatRange(
              buckets[index]?.start,
              bucketSeconds,
            )}`}
          />
        ))}
      </div>
      <span className="uptime-screen__percent">
        {formatPercent(screen.uptimePercent)}
      </span>
      <span className="uptime-screen__note">
        {screen.downSeconds > 0
          ? `${formatSeconds(screen.downSeconds)} down`
          : screen.impairedSeconds > 0
            ? `${formatSeconds(screen.impairedSeconds)} impaired`
            : screen.uptimePercent === null
              ? "Not reporting yet"
              : "No interruptions"}
      </span>
    </div>
  );
}

function Segment({ kind, percent }: { kind: UptimeState; percent: number }) {
  if (percent <= 0) return null;
  return (
    <span
      className={`uptime-chart__segment uptime-chart__segment--${kind}`}
      style={{ height: `${percent}%` }}
    />
  );
}

function UptimeTrend({ report }: { report: UptimeReport }) {
  if (report.uptimePercent === null || report.previousUptimePercent === null) {
    return <small className="uptime-trend">No comparable earlier window</small>;
  }
  const delta = report.uptimePercent - report.previousUptimePercent;
  if (Math.abs(delta) < 0.05) {
    return (
      <small className="uptime-trend">Unchanged from the previous window</small>
    );
  }
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <small
      className={
        delta > 0
          ? "uptime-trend uptime-trend--up"
          : "uptime-trend uptime-trend--down"
      }
    >
      <Icon size={14} aria-hidden="true" />
      {`${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} points vs previous window`}
    </small>
  );
}

function chartDescription(report: UptimeReport) {
  const bucketsWithDowntime = report.buckets.filter(
    (bucket) => bucket.downPercent > 0,
  ).length;
  return `${report.windowLabel}: ${formatPercent(report.uptimePercent)} up across ${
    report.screensTracked
  } screens, ${formatSeconds(report.downSeconds)} down, with downtime in ${bucketsWithDowntime} of ${
    report.buckets.length
  } intervals.`;
}

function bucketTitle(bucket: UptimeBucket, bucketSeconds: number) {
  const parts = [
    `Up ${bucket.upPercent.toFixed(1)}%`,
    `Impaired ${bucket.impairedPercent.toFixed(1)}%`,
    `Down ${bucket.downPercent.toFixed(1)}%`,
  ];
  if (bucket.unknownPercent > 0) {
    parts.push(`No data ${bucket.unknownPercent.toFixed(1)}%`);
  }
  if (bucket.screensDown > 0) {
    parts.push(`${bucket.screensDown} screen(s) down`);
  }
  return `${formatRange(bucket.start, bucketSeconds)} · ${parts.join(" · ")}`;
}

function formatRange(start: string | undefined, bucketSeconds: number) {
  if (!start) return "";
  const from = new Date(start);
  const to = new Date(from.getTime() + bucketSeconds * 1000);
  return `${formatClock(from)}–${formatClock(to)} ${from.toLocaleDateString(
    [],
    {
      month: "short",
      day: "numeric",
    },
  )}`;
}

function formatClock(value: Date) {
  return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatAxis(start: string, window: UptimeWindow) {
  const value = new Date(start);
  return window === "24h"
    ? value.toLocaleTimeString([], { hour: "numeric" })
    : value.toLocaleDateString([], { weekday: "short" });
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  return value === 100 ? "100%" : `${value.toFixed(1)}%`;
}

function formatSeconds(seconds: number) {
  if (seconds <= 0) return "None";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.round(seconds)}s`;
}
