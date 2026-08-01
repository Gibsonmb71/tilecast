import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { LayoutList, PlaylistList } from "../api/types";
import { Button, Dialog, Field } from "./ui";
import "./QuickPresentDialog.css";

type QuickPresentContentType = "playlist" | "layout" | "asset";

export function QuickPresentDialog({
  open,
  targetType,
  targetId,
  destinationName,
  csrfToken,
  onClose,
  onSuccess,
}: {
  open: boolean;
  targetType: "screen" | "group";
  targetId: string;
  destinationName: string;
  csrfToken: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const [contentType, setContentType] =
    useState<QuickPresentContentType>("playlist");
  const [contentId, setContentId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState<0 | 5 | 15 | 30 | 60>(
    15,
  );
  const [wakeDisplay, setWakeDisplay] = useState(false);
  const playlists = useQuery<PlaylistList>({
    queryKey: ["quick-present", "playlists"],
    queryFn: () => api.playlists(),
    enabled: open,
  });
  const layouts = useQuery<LayoutList>({
    queryKey: ["quick-present", "layouts"],
    queryFn: () => api.layouts(),
    enabled: open,
  });
  const assets = useQuery({
    queryKey: ["quick-present", "assets"],
    queryFn: () =>
      api.assets(
        new URLSearchParams({ page: "1", pageSize: "100", status: "ready" }),
      ),
    enabled: open,
  });
  const availableAssets = useMemo(
    () =>
      (assets.data?.items ?? []).filter((asset) =>
        ["image", "video", "widget"].includes(asset.type),
      ),
    [assets.data?.items],
  );
  const contentOptions = useMemo(() => {
    if (contentType === "playlist")
      return (playlists.data?.items ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        detail: `${item.itemCount} item${item.itemCount === 1 ? "" : "s"}`,
      }));
    if (contentType === "layout")
      return (layouts.data?.items ?? [])
        .filter((item) => item.publishedRevision != null)
        .map((item) => ({
          id: item.id,
          name: item.name,
          detail: `${item.canvasWidth} × ${item.canvasHeight}`,
        }));
    return availableAssets.map((item) => ({
      id: item.id,
      name: item.name,
      detail: item.type,
    }));
  }, [
    availableAssets,
    contentType,
    layouts.data?.items,
    playlists.data?.items,
  ]);
  useEffect(() => {
    if (!open) return;
    setContentId((current) =>
      contentOptions.some((item) => item.id === current)
        ? current
        : (contentOptions[0]?.id ?? ""),
    );
  }, [contentOptions, open]);
  const present = useMutation({
    mutationFn: () =>
      api.createPresentationOverride(
        {
          targetType,
          targetId,
          contentType,
          contentId,
          durationMinutes,
          afterAction: "resume",
          wakeDisplay,
        },
        csrfToken,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["presentation-overrides"],
      });
      onSuccess?.();
      onClose();
    },
  });
  const loading =
    playlists.isLoading ||
    layouts.isLoading ||
    assets.isLoading ||
    present.isPending;
  return (
    <Dialog
      open={open}
      title="Show now"
      onClose={onClose}
      className="quick-present-dialog"
    >
      <div className="quick-present-dialog__body">
        <p className="quick-present-dialog__intro">
          Temporarily replace normal scheduled content on {destinationName}.
          Emergency Takeovers and AirPlay remain higher priority.
        </p>
        <Field label="Destination">
          <div className="quick-present-dialog__destination">
            {destinationName}
          </div>
        </Field>
        <Field label="Content" required>
          <div
            className="quick-present-dialog__content-type"
            role="tablist"
            aria-label="Content type"
          >
            {(["playlist", "layout", "asset"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={contentType === type}
                className={contentType === type ? "is-active" : ""}
                onClick={() => {
                  setContentType(type);
                  setContentId("");
                }}
              >
                {type === "asset"
                  ? "Media or widget"
                  : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
          <select
            className="input"
            value={contentId}
            onChange={(event) => setContentId(event.target.value)}
            disabled={loading || contentOptions.length === 0}
          >
            {contentOptions.length === 0 ? (
              <option value="">No ready content available</option>
            ) : (
              contentOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.detail}
                </option>
              ))
            )}
          </select>
        </Field>
        <fieldset className="quick-present-dialog__durations">
          <legend>Duration</legend>
          {[5, 15, 30, 60, 0].map((value) => (
            <label className="radio-control" key={value}>
              <input
                type="radio"
                name="quick-present-duration"
                checked={durationMinutes === value}
                onChange={() =>
                  setDurationMinutes(value as 0 | 5 | 15 | 30 | 60)
                }
              />
              <span>{value === 0 ? "Until stopped" : `${value} min`}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Afterward">
          <div className="quick-present-dialog__destination">
            Resume normal content
          </div>
        </Field>
        <label className="checkbox-control">
          <input
            type="checkbox"
            checked={wakeDisplay}
            onChange={(event) => setWakeDisplay(event.target.checked)}
          />
          <span>Wake display if needed</span>
        </label>
        {present.error && (
          <div className="notice notice--error" role="alert">
            {present.error.message}
          </div>
        )}
      </div>
      <footer className="quick-present-dialog__footer">
        <Button type="button" variant="quiet" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          disabled={loading || !contentId}
          onClick={() => present.mutate()}
        >
          {present.isPending ? "Showing…" : "Show now"}
        </Button>
      </footer>
    </Dialog>
  );
}
