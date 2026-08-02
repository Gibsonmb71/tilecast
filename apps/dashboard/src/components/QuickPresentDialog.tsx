import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { LayoutList, PlaylistList } from "../api/types";
import { Button, Checkbox, Dialog, Field, Select, ToggleGroup } from "./ui";
import "./QuickPresentDialog.css";

type QuickPresentContentType = "playlist" | "layout" | "asset";

const contentTypes: readonly {
  value: QuickPresentContentType;
  label: string;
}[] = [
  { value: "playlist", label: "Playlist" },
  { value: "layout", label: "Layout" },
  { value: "asset", label: "Media / web" },
];

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
          Temporarily show content on <strong>{destinationName}</strong>.
          <span>
            Normal content resumes when this session ends. Emergency Takeovers
            and AirPlay remain higher priority.
          </span>
        </p>
        <div className="quick-present-dialog__field">
          <span className="field__label">
            Content <span aria-hidden="true">*</span>
          </span>
          <ToggleGroup
            className="quick-present-dialog__content-type"
            label="Content type"
            value={contentType}
            items={contentTypes}
            onValueChange={(type) => {
              setContentType(type);
              setContentId("");
            }}
          />
          <Select
            aria-label="Content selection"
            className="quick-present-dialog__select"
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
          </Select>
        </div>
        <Field label="Duration">
          <Select
            value={durationMinutes}
            onChange={(event) =>
              setDurationMinutes(
                Number(event.target.value) as 0 | 5 | 15 | 30 | 60,
              )
            }
          >
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>1 hour</option>
            <option value={0}>Until stopped</option>
          </Select>
        </Field>
        <Checkbox
          label="Wake display if needed"
          checked={wakeDisplay}
          onChange={(event) => setWakeDisplay(event.target.checked)}
        />
        {present.error && (
          <div className="notice notice--error" role="alert">
            {present.error.message}
          </div>
        )}
      </div>
      <footer className="form-actions quick-present-dialog__actions">
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
