import { useQuery } from "@tanstack/react-query";
import { Check, LayoutTemplate, ListVideo, Tags } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import type { LayoutSummary, Playlist } from "../../api/types";
import { Button, Dialog } from "../ui";
import { DashboardSearch } from "../DashboardListToolbar";
import { LayoutPreview, PlaylistPreview } from "../PresentationPreview";

export type PlaylistPickerChoice =
  | { kind: "playlist"; playlist: Playlist }
  | { kind: "layout"; layout: LayoutSummary };

export type PlaylistPickerProps = {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  /**
   * Also offer published Layouts. Schedules can target either, while a playlist zone
   * inside a Layout can only hold a playlist.
   */
  includeLayouts?: boolean;
  /** Highlighted on open, so reopening the picker shows the current choice. */
  selectedId?: string;
  onConfirm: (choice: PlaylistPickerChoice) => void;
  onClose: () => void;
};

/**
 * Browses the whole playlist library rather than a fixed shelf: search runs server-side
 * so entries past the first page are still reachable.
 */
export function PlaylistPicker({
  open,
  title,
  description,
  confirmLabel = "Add playlist",
  includeLayouts = false,
  selectedId = "",
  onConfirm,
  onClose,
}: PlaylistPickerProps) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState(selectedId);
  const playlists = useQuery({
    queryKey: ["playlist-picker", "playlists", search],
    queryFn: () => api.playlists(search),
    enabled: open,
  });
  const layouts = useQuery({
    queryKey: ["playlist-picker", "layouts", search],
    queryFn: () => api.layouts(search),
    enabled: open && includeLayouts,
  });

  const playlistItems = playlists.data?.items ?? [];
  // An unpublished Layout has nothing a player could show, so it is not offerable.
  const layoutItems = includeLayouts
    ? (layouts.data?.items ?? []).filter((layout) => layout.publishedRevision)
    : [];
  const choices: PlaylistPickerChoice[] = [
    ...playlistItems.map((playlist) => ({
      kind: "playlist" as const,
      playlist,
    })),
    ...layoutItems.map((layout) => ({ kind: "layout" as const, layout })),
  ];
  const idOf = (choice: PlaylistPickerChoice) =>
    choice.kind === "playlist" ? choice.playlist.id : choice.layout.id;
  const selected = choices.find((choice) => idOf(choice) === chosen);

  const loading = playlists.isLoading || (includeLayouts && layouts.isLoading);
  const failed = playlists.isError || (includeLayouts && layouts.isError);
  const noun = includeLayouts ? "presentations" : "playlists";

  return (
    <Dialog
      open={open}
      title={
        title ?? (includeLayouts ? "Choose presentation" : "Choose playlist")
      }
      onClose={onClose}
      className="playlist-picker"
    >
      {description && (
        <p className="playlist-picker__description">{description}</p>
      )}
      <DashboardSearch
        autoFocus
        value={search}
        onValueChange={setSearch}
        label={`Search ${noun}`}
        placeholder={`Search ${noun}`}
      />
      <div className="playlist-picker__results">
        {loading ? (
          <p className="status-copy">Loading {noun}…</p>
        ) : failed ? (
          <div className="notice notice--error">
            <strong>
              {includeLayouts ? "Presentations" : "Playlists"} could not be
              loaded.
            </strong>
            <button
              className="button button--quiet"
              onClick={() => {
                void playlists.refetch();
                if (includeLayouts) void layouts.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : !choices.length ? (
          <p className="status-copy">
            {search
              ? `No ${noun} match this search.`
              : `No ${noun} yet. Create one first.`}
          </p>
        ) : (
          choices.map((choice) => {
            const id = idOf(choice);
            const tagDriven =
              choice.kind === "playlist" &&
              choice.playlist.sourceType === "tag";
            return (
              <button
                type="button"
                key={`${choice.kind}-${id}`}
                className={id === chosen ? "is-selected" : ""}
                aria-pressed={id === chosen}
                onClick={() => setChosen(id)}
                onDoubleClick={() => onConfirm(choice)}
              >
                <span
                  className="playlist-picker__preview"
                  data-orientation={
                    choice.kind === "layout"
                      ? choice.layout.orientation
                      : undefined
                  }
                  aria-hidden="true"
                >
                  {choice.kind === "layout" ? (
                    <LayoutPreview layout={choice.layout} />
                  ) : (
                    <PlaylistPreview playlist={choice.playlist} />
                  )}
                </span>
                <span className="playlist-picker__icon" aria-hidden="true">
                  {choice.kind === "layout" ? (
                    <LayoutTemplate size={17} />
                  ) : tagDriven ? (
                    <Tags size={17} />
                  ) : (
                    <ListVideo size={17} />
                  )}
                </span>
                <span className="playlist-picker__label">
                  <strong>
                    {choice.kind === "playlist"
                      ? choice.playlist.name
                      : choice.layout.name}
                  </strong>
                  <small>
                    {choice.kind === "layout"
                      ? `Layout · revision ${choice.layout.publishedRevision}`
                      : `${choice.playlist.itemCount} item${
                          choice.playlist.itemCount === 1 ? "" : "s"
                        }${tagDriven ? " · tag-driven" : ""}`}
                  </small>
                </span>
                {id === chosen && <Check size={17} aria-hidden="true" />}
              </button>
            );
          })
        )}
      </div>
      <footer className="playlist-picker__footer">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!selected}
          onClick={() => selected && onConfirm(selected)}
        >
          {confirmLabel}
        </Button>
      </footer>
    </Dialog>
  );
}
