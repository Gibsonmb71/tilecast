import {
  CalendarDays,
  Check,
  FileImage,
  FileVideo,
  Globe2,
  Youtube,
} from "lucide-react";
import type { Asset, YouTubeConfig } from "../../api/types";

function statusLabel(status: Asset["processingStatus"]) {
  return (
    {
      ready: "Ready",
      uploading: "Uploading",
      uploaded: "Uploaded",
      queued: "Waiting",
      inspecting: "Inspecting",
      processing: "Processing",
      failed: "Failed",
      deleting: "Deleting",
      deleted: "Deleted",
    }[status] ?? status
  );
}

export function ContentLibraryGrid({
  items,
  view,
  selectedIds,
  disabledIds,
  highlightedIds,
  onToggle,
}: {
  items: Asset[];
  view: "grid" | "list";
  selectedIds: Set<string>;
  disabledIds: Set<string>;
  highlightedIds: Set<string>;
  onToggle: (asset: Asset) => void;
}) {
  return (
    <div className={`picker-library picker-library--${view}`}>
      {items.map((asset) => {
        const selected = selectedIds.has(asset.id);
        const disabled =
          disabledIds.has(asset.id) || asset.processingStatus !== "ready";
        const youtube = asset.source?.provider === "youtube";
        const calendar = asset.source?.provider === "calendar";
        const videoId = youtube
          ? (asset.source?.configuration as YouTubeConfig).videoId
          : undefined;
        return (
          <button
            type="button"
            key={asset.id}
            className={`picker-content-card${selected ? " is-selected" : ""}${highlightedIds.has(asset.id) ? " is-new" : ""}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onToggle(asset)}
          >
            <span className="picker-content-card__preview">
              {videoId ? (
                <img
                  src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                  alt=""
                  referrerPolicy="origin"
                />
              ) : asset.thumbnailUrl ? (
                <img src={asset.thumbnailUrl} alt="" />
              ) : asset.type === "image" ? (
                <FileImage size={30} />
              ) : asset.type === "video" ? (
                <FileVideo size={30} />
              ) : youtube ? (
                <Youtube size={30} />
              ) : calendar ? (
                <CalendarDays size={30} />
              ) : (
                <Globe2 size={30} />
              )}
              {selected && (
                <span className="picker-selection-mark" aria-hidden="true">
                  <Check size={16} />
                </span>
              )}
            </span>
            <span className="picker-content-card__details">
              <strong>{asset.name}</strong>
              <small>
                {asset.type === "source"
                  ? asset.source?.provider === "youtube"
                    ? "YouTube Source"
                    : asset.source?.provider === "calendar"
                      ? "Calendar Source"
                      : "Website Source"
                  : asset.type === "image"
                    ? "Image"
                    : "Video"}
              </small>
            </span>
            <span
              className={`media-status media-status--${asset.processingStatus}`}
            >
              {statusLabel(asset.processingStatus)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
