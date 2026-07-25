// ScreenContentChain walks the dependency graph downward from a screen: what is assigned, what
// content it contains, and which Data Sources feed it. This is the direction that answers "why does
// this screen look stale?" — the source status is shown next to the source, so a failed refresh is
// visible from the screen rather than only from the Data Source page.
//
// Both assignment kinds resolve completely. A Layout's stored dependencies already name every
// Data Source it reaches, including sources reached through a text binding with no Widget. A
// playlist reports the sources reached through its items — read server-side, so closing this leg
// costs one query rather than a detail request per playlist item.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api/client";
import type { PlaylistAssignment } from "../api/types";
import { StatusDot } from "../components/ui";

function statusTone(status: string) {
  if (status === "ready") return "success" as const;
  if (status === "error") return "danger" as const;
  return "info" as const;
}

function statusText(status: string, recordCount: number) {
  if (status === "error") return "Last refresh failed";
  if (status !== "ready") return status.replaceAll("_", " ");
  return `${recordCount} record${recordCount === 1 ? "" : "s"}`;
}

export function ScreenContentChain({
  assignment,
}: {
  assignment?: PlaylistAssignment;
}) {
  const layoutId = assignment?.layoutId;
  const playlistId = assignment?.playlistId;
  const layout = useQuery({
    queryKey: ["layouts", layoutId],
    queryFn: () => api.layout(layoutId!),
    enabled: Boolean(layoutId),
  });
  const playlist = useQuery({
    queryKey: ["playlists", playlistId],
    queryFn: () => api.playlist(playlistId!),
    enabled: Boolean(playlistId),
  });
  // One list read resolves every source's name and status for either assignment kind; the Layout
  // and the playlist both report only dependency IDs.
  const sources = useQuery({
    queryKey: ["screen-chain-data-sources"],
    queryFn: () =>
      api.listDataSources(
        new URLSearchParams({ page: "1", pageSize: "100", sort: "name" }),
      ),
    enabled: Boolean(layoutId || playlistId),
  });

  if (!layoutId && !playlistId) return null;

  const resolve = (ids: string[]) =>
    (sources.data?.items ?? []).filter((source) => ids.includes(source.id));
  const layoutSources = resolve(
    (layout.data?.dependencies ?? [])
      .filter((dependency) => dependency.type === "data_source")
      .map((dependency) => dependency.id),
  );
  const playlistSources = resolve(playlist.data?.dataSourceIds ?? []);
  const widgetItems = (playlist.data?.items ?? []).filter(
    (item) => item.assetType === "widget",
  );

  return (
    <section className="screen-chain">
      <h4>Content and data on this screen</h4>
      {layoutId && (
        <>
          <ul className="screen-chain__list">
            <li>
              <Link to={`/layouts/${layoutId}`}>
                <span>{assignment?.layoutName ?? "Assigned Layout"}</span>
                <small>Layout</small>
              </Link>
            </li>
          </ul>
          {layout.isLoading ? (
            <p className="screen-chain__note">Resolving Layout data…</p>
          ) : layoutSources.length === 0 ? (
            <p className="screen-chain__note">
              This Layout reads no Data Sources.
            </p>
          ) : (
            <ul className="screen-chain__list">
              {layoutSources.map((source) => (
                <li key={source.id}>
                  <Link to={`/data-sources/${source.id}`}>
                    <span>{source.name}</span>
                    <StatusDot
                      tone={statusTone(source.status)}
                      label={statusText(
                        source.status,
                        source.cachedRecordCount,
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {playlistId && (
        <>
          <ul className="screen-chain__list">
            <li>
              <Link to={`/playlists/${playlistId}`}>
                <span>{assignment?.playlistName ?? "Assigned playlist"}</span>
                <small>
                  {playlist.data?.itemCount ?? 0} item
                  {playlist.data?.itemCount === 1 ? "" : "s"}
                </small>
              </Link>
            </li>
          </ul>
          {widgetItems.length > 0 && (
            <ul className="screen-chain__list">
              {widgetItems.map((item) => (
                <li key={item.id}>
                  <Link to={`/widgets/${item.assetId}`}>
                    <span>{item.assetName}</span>
                    <small>Widget</small>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {playlist.isLoading ? (
            <p className="screen-chain__note">Resolving playlist data…</p>
          ) : playlistSources.length === 0 ? (
            <p className="screen-chain__note">
              Nothing in this playlist reads a Data Source.
            </p>
          ) : (
            <ul className="screen-chain__list">
              {playlistSources.map((source) => (
                <li key={source.id}>
                  <Link to={`/data-sources/${source.id}`}>
                    <span>{source.name}</span>
                    <StatusDot
                      tone={statusTone(source.status)}
                      label={statusText(
                        source.status,
                        source.cachedRecordCount,
                      )}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
