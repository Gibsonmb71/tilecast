import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { Asset } from "../api/types";
import {
  ContentPicker,
  PlaylistPicker,
  type PlaylistPickerChoice,
} from "./content-picker";
import { Button, Checkbox, Dialog, Field, Select, ToggleGroup } from "./ui";
import "./QuickPresentDialog.css";

type QuickPresentContentType = "playlist" | "layout" | "asset";

type QuickPresentSelection = {
  type: QuickPresentContentType;
  id: string;
  name: string;
  detail: string;
};

const contentTypes: readonly {
  value: QuickPresentContentType;
  label: string;
}[] = [
  { value: "playlist", label: "Playlist" },
  { value: "layout", label: "Layout" },
  { value: "asset", label: "Media / web" },
];

function assetDetail(asset: Asset) {
  if (asset.type === "image") return "Image";
  if (asset.type === "video") return "Video";
  return asset.widget?.provider === "youtube"
    ? "YouTube widget"
    : "Website widget";
}

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
  const [selectedContent, setSelectedContent] =
    useState<QuickPresentSelection>();
  const [picker, setPicker] = useState<QuickPresentContentType>();
  const pickerOpen = open && picker !== undefined;

  const chooseContent = (selection: QuickPresentSelection) => {
    setContentType(selection.type);
    setContentId(selection.id);
    setSelectedContent(selection);
    setPicker(undefined);
  };

  const changeContentType = (type: QuickPresentContentType) => {
    setContentType(type);
    setContentId("");
    setSelectedContent(undefined);
  };
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
  const selectedForType =
    selectedContent?.type === contentType ? selectedContent : undefined;
  const contentTypeLabel =
    contentType === "asset" ? "media or web" : contentType;
  return (
    <>
      <Dialog
        open={open && !pickerOpen}
        title="Show now"
        onClose={() => {
          if (!pickerOpen) onClose();
        }}
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
          <Field label="Content" required>
            <ToggleGroup
              className="quick-present-dialog__content-type"
              label="Content type"
              value={contentType}
              items={contentTypes}
              onValueChange={changeContentType}
            />
            {selectedForType ? (
              <div className="quick-present-dialog__content-selection">
                <span className="quick-present-dialog__content-selection-copy">
                  <strong>{selectedForType.name}</strong>
                  <small>{selectedForType.detail}</small>
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  compact
                  onClick={() => setPicker(contentType)}
                  disabled={present.isPending}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPicker(contentType)}
                disabled={present.isPending}
              >
                Choose {contentTypeLabel}
              </Button>
            )}
          </Field>
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
            disabled={present.isPending || !contentId}
            onClick={() => present.mutate()}
          >
            {present.isPending ? "Showing…" : "Show now"}
          </Button>
        </footer>
      </Dialog>
      {open && picker === "playlist" && (
        <PlaylistPicker
          open
          allowedKinds={["playlist"]}
          title="Choose playlist"
          description="Select a playlist from your library to show now."
          confirmLabel="Use playlist"
          selectedId={contentType === "playlist" ? contentId : ""}
          onConfirm={(choice: PlaylistPickerChoice) => {
            if (choice.kind !== "playlist") return;
            chooseContent({
              type: "playlist",
              id: choice.playlist.id,
              name: choice.playlist.name,
              detail: `${choice.playlist.itemCount} item${choice.playlist.itemCount === 1 ? "" : "s"}`,
            });
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
      {open && picker === "layout" && (
        <PlaylistPicker
          open
          allowedKinds={["layout"]}
          title="Choose layout"
          description="Select a published layout from your library to show now."
          confirmLabel="Use layout"
          selectedId={contentType === "layout" ? contentId : ""}
          onConfirm={(choice: PlaylistPickerChoice) => {
            if (choice.kind !== "layout") return;
            chooseContent({
              type: "layout",
              id: choice.layout.id,
              name: choice.layout.name,
              detail: `${choice.layout.canvasWidth} × ${choice.layout.canvasHeight} · revision ${choice.layout.publishedRevision}`,
            });
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
      {open && picker === "asset" && (
        <ContentPicker
          open
          mode="single"
          csrf={csrfToken}
          allowedTypes={["image", "video", "widget"]}
          selectedIds={contentType === "asset" && contentId ? [contentId] : []}
          title="Choose media or web"
          description="Select ready media or a website or app from your content library."
          confirmLabel="Use content"
          onConfirm={(items) => {
            const asset = items[0];
            if (!asset) return;
            chooseContent({
              type: "asset",
              id: asset.id,
              name: asset.name,
              detail: assetDetail(asset),
            });
          }}
          onClose={() => setPicker(undefined)}
        />
      )}
    </>
  );
}
