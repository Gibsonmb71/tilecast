import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";

export function SnapshotHistoryPanel({ screenId }: { screenId: string }) {
  const history = useQuery({
    queryKey: ["screen-snapshots", screenId],
    queryFn: () => api.screenSnapshots(screenId),
  });
  const [openId, setOpenId] = useState<string>();

  if (history.isLoading)
    return (
      <div className="snapshot-history">
        <div className="table-loading">Loading snapshot history…</div>
      </div>
    );
  if (history.error)
    return (
      <div className="snapshot-history">
        <div className="notice notice--error" role="alert">
          {history.error.message}
        </div>
      </div>
    );

  const data = history.data;
  if (!data?.enabled)
    return (
      <div className="snapshot-history">
        <div className="empty-card">
          <strong>Snapshot history is off.</strong>
          <p>
            Tilecast is not keeping images of what this screen showed. An Owner
            or Administrator can turn it on under{" "}
            <Link to="/settings/snapshots">Settings, Snapshot history</Link>.
          </p>
        </div>
      </div>
    );

  if (!data.items.length)
    return (
      <div className="snapshot-history">
        <div className="empty-card">
          No snapshots yet. Tilecast captures a frame on a schedule from screens
          that are reporting.
        </div>
      </div>
    );

  return (
    <div className="snapshot-history">
      <p className="role-description">
        Retains up to {data.maxPerScreen} per screen for {data.retentionDays}{" "}
        days.
      </p>
      <div className="snapshot-grid">
        {data.items.map((snapshot) => (
          <figure key={snapshot.id}>
            <button
              type="button"
              className="snapshot-thumb"
              aria-label={`View the snapshot from ${new Date(snapshot.capturedAt).toLocaleString()}`}
              onClick={() =>
                setOpenId(openId === snapshot.id ? undefined : snapshot.id)
              }
            >
              <img
                src={`/api/v1/screens/${screenId}/snapshots/${snapshot.id}/image`}
                alt={`Screen at ${new Date(snapshot.capturedAt).toLocaleString()}`}
                loading="lazy"
              />
            </button>
            <figcaption>
              {new Date(snapshot.capturedAt).toLocaleString()}
              {snapshot.trigger === "manual" ? " · manual" : ""}
            </figcaption>
            {openId === snapshot.id && (
              <a
                className="button button--quiet button--compact"
                href={`/api/v1/screens/${screenId}/snapshots/${snapshot.id}/image`}
                target="_blank"
                rel="noreferrer"
              >
                Open full size
              </a>
            )}
          </figure>
        ))}
      </div>
    </div>
  );
}
