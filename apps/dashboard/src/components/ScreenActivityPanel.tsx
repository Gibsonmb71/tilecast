import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { AlertTriangle, Clock3, MonitorCheck } from "lucide-react";
import "./ScreenActivityPanel.css";

type ScreenActivity = {
  screenId: string;
  currentPresentation?: Proof;
  recentProofOfPlay: Proof[];
  recentEvents: Event[];
  playbackGaps: number;
  lastHealthyPlayback?: string;
  lastSuccessfulManifestActivation?: string;
  currentIssue?: {
    kind: string;
    severity: string;
    description: string;
    occurredAt: string;
  };
};
type Proof = {
  id: string;
  startedAt: string;
  endedAt?: string;
  presentationName?: string;
  presentationId?: string;
  contentName?: string;
  contentId?: string;
  result: string;
  actualDurationMs?: number;
};
type Event = {
  id: string;
  timestamp: string;
  eventType: string;
  severity: string;
  description: string;
  result: string;
};

async function loadScreenActivity(id: string): Promise<ScreenActivity> {
  const response = await fetch(`/api/v1/activity/screens/${id}`, {
    credentials: "same-origin",
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: ScreenActivity;
    error?: { message?: string };
  };
  if (!response.ok || !body.data)
    throw new Error(
      body.error?.message ?? "Screen Activity could not be loaded.",
    );
  return body.data;
}

export function ScreenActivityPanel({ screenId }: { screenId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tabTarget, setTabTarget] = useState<HTMLElement | null>(null);
  const query = useQuery({
    queryKey: ["activity", "screen", screenId],
    queryFn: () => loadScreenActivity(screenId),
    refetchInterval: 20_000,
  });

  useEffect(() => {
    const find = () => {
      const target = document.querySelector<HTMLElement>(".screen-detail-tabs");
      if (target) {
        target
          .querySelectorAll("button[aria-current]")
          .forEach((button) => button.removeAttribute("aria-current"));
      }
      setTabTarget(target);
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const data = query.data;
  return (
    <>
      {tabTarget &&
        createPortal(
          <button
            type="button"
            aria-current="page"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.set("tab", "activity");
              setSearchParams(next);
            }}
          >
            Activity
          </button>,
          tabTarget,
        )}
      <section
        className="screen-activity-panel"
        aria-labelledby="screen-activity-title"
      >
        <header>
          <div>
            <h3 id="screen-activity-title">Activity</h3>
            <p>Recent Player-confirmed playback and technical screen events.</p>
          </div>
          <Link
            className="button button--secondary"
            to={`/activity?tab=proof&screen=${screenId}`}
          >
            Open filtered Activity
          </Link>
        </header>
        {query.isLoading && (
          <div className="table-loading">Loading screen Activity…</div>
        )}
        {query.error && (
          <div className="notice notice--error">{query.error.message}</div>
        )}
        {data && (
          <>
            <div className="screen-activity-cards">
              <article>
                <MonitorCheck size={18} />
                <span>Current presentation</span>
                <strong>
                  {data.currentPresentation?.presentationName ||
                    data.currentPresentation?.presentationId ||
                    "Not reported"}
                </strong>
              </article>
              <article>
                <Clock3 size={18} />
                <span>Last healthy playback</span>
                <strong>{formatDate(data.lastHealthyPlayback)}</strong>
              </article>
              <article>
                <MonitorCheck size={18} />
                <span>Last manifest activation</span>
                <strong>
                  {formatDate(data.lastSuccessfulManifestActivation)}
                </strong>
              </article>
              <article>
                <AlertTriangle size={18} />
                <span>Playback gaps</span>
                <strong>{data.playbackGaps}</strong>
              </article>
            </div>
            {data.currentIssue && (
              <div className="notice notice--warning screen-activity-issue">
                <strong>{humanize(data.currentIssue.kind)}</strong>
                <p>{data.currentIssue.description}</p>
              </div>
            )}
            <div className="screen-activity-columns">
              <section>
                <header>
                  <h4>Recent proof of play</h4>
                </header>
                {data.recentProofOfPlay.length ? (
                  data.recentProofOfPlay.map((item) => (
                    <div className="screen-activity-row" key={item.id}>
                      <span>
                        <strong>
                          {item.contentName ||
                            item.contentId ||
                            item.presentationName ||
                            item.presentationId ||
                            "Presentation"}
                        </strong>
                        <small>{formatDate(item.startedAt)}</small>
                      </span>
                      <span
                        className={`activity-badge activity-badge--${item.result}`}
                      >
                        {humanize(item.result)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="screen-activity-empty">
                    No proof of play has been reported.
                  </p>
                )}
              </section>
              <section>
                <header>
                  <h4>Recent technical events</h4>
                </header>
                {data.recentEvents.length ? (
                  data.recentEvents.map((item) => (
                    <div className="screen-activity-row" key={item.id}>
                      <span>
                        <strong>{humanize(item.eventType)}</strong>
                        <small>{formatDate(item.timestamp)}</small>
                      </span>
                      <span
                        className={`activity-badge activity-badge--${item.severity}`}
                      >
                        {humanize(item.severity)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="screen-activity-empty">
                    No technical events have been reported.
                  </p>
                )}
              </section>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function formatDate(value?: string) {
  return value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not reported";
}
function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replaceAll(".", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
