// The one Data Source creation flow: choose a provider from the catalog gallery, then run
// its editor beside the setup guidance for that provider.
//
// It lives under content/ rather than in the Data Sources page because creating data from
// inside a Widget or a Layout must be the same flow, not a reduced copy of it. Before this
// module, the in-editor path offered a plain provider list and a bare editor while the page
// offered the gallery and the setup checklist, so the two surfaces taught authors different
// things about the same task.
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Lightbulb, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import type { DataSourceDefinition, DataSourceProvider } from "../api/types";
import { DataSourceEditor } from "./DataSourceEditors";
import {
  providerGalleryDescription,
  providerLabel,
  resolveSetup,
  sourceIcon,
} from "./dataSourceProviderMeta";

function useDataSourceDefinitions(
  providers?: DataSourceProvider[],
  exclude?: DataSourceProvider[],
) {
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
    staleTime: 5 * 60_000,
  });
  const all = definitions.data?.dataSources ?? [];
  return {
    isLoading: definitions.isLoading,
    all,
    // An empty or absent list means "everything in the catalog"; a Widget that accepts
    // only some providers must not be offered the rest.
    offered: all.filter(
      (definition) =>
        (!providers?.length || providers.includes(definition.id)) &&
        !exclude?.includes(definition.id),
    ),
  };
}

export function DataSourceProviderGallery({
  providers,
  exclude,
  description,
  onChoose,
  onClose,
  page = false,
}: {
  providers?: DataSourceProvider[];
  // Providers this surface must never offer, whatever the catalog contains.
  exclude?: DataSourceProvider[];
  description?: string;
  onChoose: (provider: DataSourceProvider) => void;
  onClose: () => void;
  page?: boolean;
}) {
  const definitions = useDataSourceDefinitions(providers, exclude);
  useEffect(() => {
    if (page) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [page, onClose]);
  return (
    <div className="details-backdrop" role={page ? undefined : "presentation"}>
      <section
        className="source-gallery"
        role={page ? undefined : "dialog"}
        aria-modal={page ? undefined : true}
        aria-labelledby="data-source-gallery-title"
      >
        <header>
          <div>
            <h2 id="data-source-gallery-title">Create Data Source</h2>
            <p>
              {description ??
                `Choose what you are connecting. Every provider uses the same compact, predictable setup pattern. ${definitions.offered.length} typed projectors are available in the current server catalog.`}
            </p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="source-provider-grid">
          {definitions.offered.map((definition) => (
            <button
              type="button"
              key={definition.id}
              onClick={() => onChoose(definition.id)}
            >
              {sourceIcon(definition.id, definition, 30)}
              <strong>{definition.name}</strong>
              <span>{providerGalleryDescription(definition)}</span>
            </button>
          ))}
        </div>
        {!definitions.isLoading && definitions.offered.length === 0 && (
          <p className="source-gallery__empty">
            No Data Source providers are available in this installation.
          </p>
        )}
      </section>
    </div>
  );
}

export function DataSourceCreateShell({
  provider,
  definition,
  csrf,
  backLabel = "Data Sources",
  onClose,
  onSaved,
}: {
  provider: DataSourceProvider;
  definition?: DataSourceDefinition;
  csrf: string;
  backLabel?: string;
  onClose: () => void;
  onSaved: (value: { id: string }) => void;
}) {
  const copy = resolveSetup(provider, definition);
  const label =
    definition && !definition.legacyEditor
      ? definition.name
      : providerLabel(provider);
  return (
    <div
      className={`data-source-create-shell data-source-create-shell--${provider}`}
    >
      <header className="data-source-create-shell__header">
        <button
          className="button button--quiet"
          type="button"
          onClick={onClose}
        >
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <div>
          <span className="data-source-create-shell__icon">
            {sourceIcon(provider, definition)}
          </span>
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h2>Create {label} Data Source</h2>
            <p>{copy.description}</p>
          </div>
        </div>
      </header>
      <div className="data-source-create-shell__layout">
        <aside
          className="data-source-create-shell__guide"
          aria-label="Data Source setup guidance"
        >
          {copy.steps.length > 0 && (
            <>
              <h3>Setup checklist</h3>
              <ol>
                {copy.steps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
          {copy.tip && (
            <div className="data-source-create-shell__tip">
              <Lightbulb size={17} />
              <div>
                <strong>Good to know</strong>
                <p>{copy.tip}</p>
              </div>
            </div>
          )}
          <p className="data-source-create-shell__advanced-note">
            <Check size={15} /> Advanced filtering and cache controls are
            optional.
          </p>
        </aside>
        <div className="data-source-create-shell__editor">
          <DataSourceEditor
            provider={provider}
            csrf={csrf}
            onClose={onClose}
            onSaved={onSaved}
            page
          />
        </div>
      </div>
    </div>
  );
}

// ConnectDataFlow runs the same gallery and the same guided create shell inside a dialog,
// so connecting data from a Widget or a Layout never navigates away from work in progress.
export function ConnectDataFlow({
  provider,
  providers,
  exclude,
  csrf,
  onChooseProvider,
  onBack,
  onClose,
  onCreated,
}: {
  // The provider chosen so far. Undefined means the gallery step.
  provider?: DataSourceProvider;
  providers?: DataSourceProvider[];
  exclude?: DataSourceProvider[];
  csrf: string;
  onChooseProvider: (provider: DataSourceProvider) => void;
  onBack: () => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const definitions = useDataSourceDefinitions(providers, exclude);
  const definition = definitions.all.find(
    (candidate) => candidate.id === provider,
  );
  if (!provider)
    return createPortal(
      <DataSourceProviderGallery
        providers={providers}
        exclude={exclude}
        description="Choose where this content&rsquo;s data comes from. You will stay in this editor."
        onChoose={onChooseProvider}
        onClose={onClose}
      />,
      document.body,
    );
  return createPortal(
    <div
      className="details-backdrop data-source-connect-backdrop"
      role="presentation"
    >
      <section
        className="data-source-connect-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Create ${
          definition && !definition.legacyEditor
            ? definition.name
            : providerLabel(provider)
        } Data Source`}
      >
        <button
          className="icon-button data-source-connect-dialog__close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} aria-hidden />
        </button>
        <DataSourceCreateShell
          provider={provider}
          definition={definition}
          csrf={csrf}
          backLabel="All providers"
          onClose={onBack}
          onSaved={(created) => onCreated(created.id)}
        />
      </section>
    </div>,
    document.body,
  );
}
