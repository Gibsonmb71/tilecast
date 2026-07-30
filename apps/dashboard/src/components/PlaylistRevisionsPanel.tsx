import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

// A restore is a new edit, not a rewind: it produces a new revision, so the
// state it replaced stays in the history and the restore can itself be undone.
export function PlaylistRevisionsPanel({
  playlistId,
  canRestore,
}: {
  playlistId: string;
  canRestore: boolean;
}) {
  const auth = useAuth();
  const client = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";
  const [result, setResult] = useState<string>();

  const revisions = useQuery({
    queryKey: ["playlist-revisions", playlistId],
    queryFn: () => api.playlistRevisions(playlistId),
  });

  const restore = useMutation({
    mutationFn: (revision: number) =>
      api.restorePlaylistRevision(playlistId, revision, csrf),
    onSuccess: (data) => {
      setResult(
        `Restored revision ${data.restoredFrom} as revision ${data.newRevision}.` +
          (data.skippedItems > 0
            ? ` ${data.skippedItems} item${data.skippedItems === 1 ? "" : "s"} could not be restored because the content was deleted.`
            : ""),
      );
      void client.invalidateQueries({ queryKey: ["playlist-revisions"] });
      void client.invalidateQueries({ queryKey: ["playlist", playlistId] });
    },
  });

  if (revisions.isLoading)
    return <div className="table-loading">Loading history…</div>;
  if (revisions.error)
    return (
      <div className="notice notice--error" role="alert">
        {revisions.error.message}
      </div>
    );

  return (
    <section className="settings-subsection">
      <header>
        <h3>History</h3>
        <p>
          The last {revisions.data?.kept} revisions are kept. Restoring makes a
          new revision, so it can be undone the same way.
        </p>
      </header>

      {result && (
        <div className="notice" role="status">
          {result}
        </div>
      )}
      {restore.error && (
        <div className="notice notice--error" role="alert">
          {restore.error.message}
        </div>
      )}

      <div className="backup-job-list">
        {revisions.data?.items.map((revision) => (
          <div key={revision.revision}>
            <span>
              <strong>
                Revision {revision.revision}
                {revision.isCurrent ? " (current)" : ""}
              </strong>
              <small>
                {new Date(revision.createdAt).toLocaleString()} ·{" "}
                {revision.itemCount} item
                {revision.itemCount === 1 ? "" : "s"}
                {revision.authorName ? ` · ${revision.authorName}` : ""}
                {revision.missingReferences > 0
                  ? ` · ${revision.missingReferences} deleted since`
                  : ""}
              </small>
            </span>
            <span className="backup-job-status">
              {canRestore && revision.restorable ? (
                <button
                  className="button button--quiet button--compact"
                  disabled={restore.isPending}
                  onClick={() => {
                    setResult(undefined);
                    restore.mutate(revision.revision);
                  }}
                >
                  <History size={14} /> Restore
                </button>
              ) : revision.isCurrent ? (
                "Current"
              ) : (
                "Nothing left to restore"
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
