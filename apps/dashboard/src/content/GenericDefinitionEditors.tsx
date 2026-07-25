import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type {
  Asset,
  DataSourceDefinition,
  DataSourceDetail,
  WidgetDefinition,
} from "../api/types";
import { DefinitionForm, dataSourceKeysIn } from "./DefinitionForm";
import { DeclarativePresentationPreview } from "./SourceEditors";
import { captureWidgetPreview } from "./widgetPreviewCapture";

export function GenericWidgetEditor({
  definition,
  asset,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
}: {
  definition: WidgetDefinition;
  asset?: Asset;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (asset: Asset) => void;
}) {
  const queryClient = useQueryClient();
  const previewRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(asset?.name ?? definition.name);
  const [description, setDescription] = useState(
    asset?.description ?? definition.description,
  );
  const [configuration, setConfiguration] = useState<Record<string, unknown>>(
    asset?.widget?.configuration ?? definition.defaultConfiguration,
  );
  const compiledPreview = useQuery({
    queryKey: ["compiled-widget-preview", definition.id, configuration],
    queryFn: () => api.compileWidgetPreview(definition.id, configuration, csrf),
    retry: false,
  });
  // Every `data_source` control in the definition is followed, not just a field literally named
  // `dataSourceId`, because a Widget may reference more than one Data Source. The first declared
  // source drives the rendered preview; all of them gate saving so the captured thumbnail is
  // never uploaded with data still in flight.
  const dataSourceIds = dataSourceKeysIn(
    definition.configurationSchema.fields,
    configuration,
  );
  const sourcePreviews = useQueries({
    queries: dataSourceIds.map((id) => ({
      queryKey: ["widget-data-source-preview", id],
      queryFn: () => api.previewSavedDataSource(id),
      retry: false,
    })),
  });
  const sourcesLoading = sourcePreviews.some((preview) => preview.isLoading);
  const primarySourcePreview = sourcePreviews[0]?.data;
  const save = useMutation({
    mutationFn: async () => {
      if (!previewRef.current || !compiledPreview.data || sourcesLoading)
        throw new Error("Wait for the Widget preview before saving.");
      const previewImage = await captureWidgetPreview(previewRef.current);
      const input = {
        provider: definition.id,
        name,
        description,
        configuration,
      };
      const saved = asset
        ? api.updateWidget(asset.id, input, csrf)
        : api.createWidget(input, csrf);
      const result = await saved;
      await api.uploadWidgetPreview(result.id, previewImage, csrf);
      return {
        ...result,
        thumbnailUrl: `/api/v1/assets/${encodeURIComponent(result.id)}/thumbnail`,
      };
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      onSaved(saved);
    },
  });
  return (
    <GenericEditorShell
      title={`${asset ? "Edit" : "Create"} ${definition.name}`}
      description={definition.description}
      name={name}
      setName={setName}
      detail={description}
      setDetail={setDescription}
      readOnly={readOnly}
      pending={save.isPending}
      saveDisabled={!compiledPreview.data || sourcesLoading}
      error={save.error}
      onClose={onClose}
      onSave={() => save.mutate()}
      saveLabel="Save Widget"
    >
      <DefinitionForm
        fields={definition.configurationSchema.fields}
        value={configuration}
        onChange={setConfiguration}
        readOnly={readOnly}
        csrf={csrf}
      />
      <div
        ref={previewRef}
        className="native-app-preview declarative-widget-preview"
      >
        {compiledPreview.data ? (
          <DeclarativePresentationPreview
            presentation={compiledPreview.data}
            source={primarySourcePreview}
            assetImageUrl={
              typeof configuration.imageAssetId === "string" &&
              configuration.imageAssetId
                ? api.assetPreviewUrl(configuration.imageAssetId)
                : undefined
            }
          />
        ) : (
          <span>Compiling presentation preview…</span>
        )}
      </div>
    </GenericEditorShell>
  );
}

export function GenericDataSourceEditor({
  definition,
  dataSource,
  csrf,
  readOnly = false,
  onClose,
  onSaved,
}: {
  definition: DataSourceDefinition;
  dataSource?: DataSourceDetail;
  csrf: string;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (source: DataSourceDetail) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(dataSource?.name ?? definition.name);
  const [description, setDescription] = useState(
    dataSource?.description ?? definition.description,
  );
  const [configuration, setConfiguration] = useState<Record<string, unknown>>(
    dataSource?.configuration ?? definition.defaultConfiguration,
  );
  const save = useMutation({
    mutationFn: () => {
      const input = {
        provider: definition.id,
        name,
        description,
        configuration,
      };
      return dataSource
        ? api.updateDataSource(dataSource.id, input, csrf)
        : api.createDataSource(input, csrf);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      onSaved(saved);
    },
  });
  return (
    <GenericEditorShell
      title={`${dataSource ? "Edit" : "Create"} ${definition.name}`}
      description={definition.description}
      name={name}
      setName={setName}
      detail={description}
      setDetail={setDescription}
      readOnly={readOnly}
      pending={save.isPending}
      saveDisabled={false}
      error={save.error}
      onClose={onClose}
      onSave={() => save.mutate()}
      saveLabel="Save Data Source"
    >
      <DefinitionForm
        fields={definition.configurationSchema.fields}
        value={configuration}
        onChange={setConfiguration}
        readOnly={readOnly}
        csrf={csrf}
      />
    </GenericEditorShell>
  );
}

function GenericEditorShell({
  title,
  description,
  name,
  setName,
  detail,
  setDetail,
  readOnly,
  pending,
  saveDisabled,
  error,
  onClose,
  onSave,
  saveLabel,
  children,
}: {
  title: string;
  description: string;
  name: string;
  setName: (value: string) => void;
  detail: string;
  setDetail: (value: string) => void;
  readOnly: boolean;
  pending: boolean;
  saveDisabled: boolean;
  error: Error | null;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="details-backdrop">
      <section className="asset-details source-editor">
        <header>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button className="button button--quiet" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Name</span>
            <input
              value={name}
              disabled={readOnly}
              maxLength={180}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field field--wide">
            <span className="field__label">Description</span>
            <textarea
              value={detail}
              disabled={readOnly}
              maxLength={2000}
              onChange={(event) => setDetail(event.target.value)}
            />
          </label>
        </div>
        {children}
        {error && (
          <div className="notice notice--error">
            {error instanceof ApiError ? error.message : error.message}
          </div>
        )}
        <footer>
          <button className="button button--quiet" onClick={onClose}>
            Cancel
          </button>
          {!readOnly && (
            <button
              className="button button--primary"
              disabled={pending || saveDisabled || !name.trim()}
              onClick={onSave}
            >
              {pending ? "Saving…" : saveLabel}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
