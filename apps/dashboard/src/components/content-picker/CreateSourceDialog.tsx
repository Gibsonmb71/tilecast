import { useEffect, useState } from "react";
import type { Asset, SourceProvider } from "../../api/types";
import {
  SourceProviderGallery,
  YouTubeSourceEditor,
} from "../../content/SourceEditors";
import { WebsiteEditor } from "../../pages/ContentPage";

export function CreateSourceDialog({
  csrf,
  onCreated,
  onClose,
}: {
  csrf: string;
  onCreated: (asset: Asset) => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<SourceProvider>();
  useEffect(() => {
    const focus = window.setTimeout(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const active = dialogs.item(dialogs.length - 1);
      active
        ?.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled)",
        )
        ?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const active = dialogs.item(dialogs.length - 1);
      if (!active) return;
      const controls = [
        ...active.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener("keydown", trap);
    return () => {
      clearTimeout(focus);
      removeEventListener("keydown", trap);
    };
  }, [provider]);
  const saved = (asset: Asset) => {
    onCreated(asset);
    onClose();
  };
  if (!provider)
    return <SourceProviderGallery onChoose={setProvider} onClose={onClose} />;
  if (provider === "website")
    return (
      <WebsiteEditor
        csrf={csrf}
        onClose={() => setProvider(undefined)}
        onSaved={saved}
      />
    );
  return (
    <YouTubeSourceEditor
      csrf={csrf}
      onClose={() => setProvider(undefined)}
      onSaved={saved}
    />
  );
}
