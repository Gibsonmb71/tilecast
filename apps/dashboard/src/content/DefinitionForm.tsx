import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type {
  ContentDefinitionField,
  DataSource,
  DataSourceDefinition,
} from "../api/types";
import { Select } from "../components/ui";

type Values = Record<string, unknown>;

function fieldText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

export function DefinitionForm({
  fields,
  value,
  onChange,
  readOnly = false,
}: {
  fields: ContentDefinitionField[];
  value: Values;
  onChange: (value: Values) => void;
  readOnly?: boolean;
}) {
  const dataSources = useQuery({
    queryKey: ["definition-form-data-sources"],
    queryFn: () =>
      api.listDataSources(
        new URLSearchParams({ page: "1", pageSize: "100", sort: "name" }),
      ),
    enabled: fields.some(
      (field) =>
        field.control === "data_source" ||
        field.control === "data_source_field",
    ),
  });
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
  });
  const assets = useQuery({
    queryKey: ["definition-form-media-assets"],
    queryFn: () =>
      api.assets(
        new URLSearchParams({
          page: "1",
          pageSize: "100",
          status: "ready",
          sort: "name",
        }),
      ),
    enabled: fields.some((field) => field.control === "media_asset"),
  });
  const selectedSourceID = fieldText(value.dataSourceId);
  const selectedSource = useQuery({
    queryKey: ["definition-form-data-source", selectedSourceID],
    queryFn: () => api.getDataSource(selectedSourceID),
    enabled: Boolean(selectedSourceID),
  });
  const set = (key: string, next: unknown) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="form-grid">
      {fields.map((field) => (
        <DefinitionControl
          key={field.key}
          field={field}
          value={value[field.key]}
          setValue={(next) => set(field.key, next)}
          readOnly={readOnly}
          dataSources={dataSources.data?.items ?? []}
          dataSourceDefinitions={definitions.data?.dataSources ?? []}
          dataSourceFields={selectedSource.data?.fields ?? []}
          assets={assets.data?.items ?? []}
        />
      ))}
    </div>
  );
}

function DefinitionControl({
  field,
  value,
  setValue,
  readOnly,
  dataSources,
  dataSourceDefinitions,
  dataSourceFields,
  assets,
}: {
  field: ContentDefinitionField;
  value: unknown;
  setValue: (value: unknown) => void;
  readOnly: boolean;
  dataSources: DataSource[];
  dataSourceDefinitions: DataSourceDefinition[];
  dataSourceFields: { key: string; label: string; type: string }[];
  assets: { id: string; name: string; type: string }[];
}) {
  const common = {
    disabled: readOnly,
    required: field.required,
  };
  const label = (
    <span className="field__label">
      {field.label}
      {field.required ? " *" : ""}
    </span>
  );
  if (field.control === "boolean")
    return (
      <label className="setting-switch">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={readOnly}
          onChange={(event) => setValue(event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  if (field.control === "multiline_text")
    return (
      <label className="field field--wide">
        {label}
        <textarea
          {...common}
          value={fieldText(value)}
          maxLength={field.maxLength}
          onChange={(event) => setValue(event.target.value)}
        />
        {field.description && <small>{field.description}</small>}
      </label>
    );
  if (
    field.control === "select" ||
    field.control === "data_source" ||
    field.control === "data_source_field" ||
    field.control === "media_asset"
  ) {
    const options =
      field.control === "select"
        ? (field.options ?? [])
        : field.control === "data_source"
          ? dataSources.map((source) => ({
              source,
              definition: dataSourceDefinitions.find(
                (definition) => definition.id === source.provider,
              ),
            }))
              .filter(({ definition }) => {
                if (!definition) return false;
                if (
                  field.acceptedDataSourceKinds?.length &&
                  !field.acceptedDataSourceKinds.includes(
                    definition.outputSchema.kind,
                  )
                )
                  return false;
                return Object.entries(field.requiredFields ?? {}).every(
                  ([key, type]) =>
                    definition.outputSchema.fields.some(
                      (output) => output.key === key && output.type === type,
                    ),
                );
              })
              .map(({ source }) => ({
                value: source.id,
                label: source.name,
              }))
          : field.control === "data_source_field"
            ? dataSourceFields
                .filter(
                  (sourceField) =>
                    !field.dataSourceFieldTypes?.length ||
                    field.dataSourceFieldTypes.includes(sourceField.type),
                )
                .map((sourceField) => ({
                  value: sourceField.key,
                  label: `${sourceField.label} (${sourceField.type})`,
                }))
            : assets
                .filter(
                  (asset) =>
                    !field.mediaTypes?.length ||
                    field.mediaTypes.includes(asset.type),
                )
                .map((asset) => ({ value: asset.id, label: asset.name }));
    return (
      <label className="field">
        {label}
        <Select
          {...common}
          value={fieldText(value)}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">Select…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </label>
    );
  }
  if (field.control === "repeating_group") {
    const items = Array.isArray(value) ? (value as Values[]) : [];
    return (
      <fieldset className="field field--wide">
        <legend>{field.label}</legend>
        {items.map((item, index) => (
          <div className="source-mapping-row" key={index}>
            <DefinitionForm
              fields={field.itemFields ?? []}
              value={item}
              readOnly={readOnly}
              onChange={(next) =>
                setValue(
                  items.map((current, currentIndex) =>
                    currentIndex === index ? next : current,
                  ),
                )
              }
            />
            {!readOnly && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${field.label} item ${index + 1}`}
                onClick={() =>
                  setValue(items.filter((_, current) => current !== index))
                }
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        {!readOnly && items.length < (field.maximumItems ?? 0) && (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setValue([...items, {}])}
          >
            <Plus size={15} /> Add item
          </button>
        )}
      </fieldset>
    );
  }
  const inputType =
    field.control === "number" || field.control === "integer"
      ? "number"
      : field.control === "datetime"
        ? "datetime-local"
        : field.control === "color"
          ? "color"
          : field.control === "date"
            ? "date"
            : field.control === "url"
              ? "url"
              : "text";
  return (
    <label className="field">
      {label}
      <input
        {...common}
        type={inputType}
        value={fieldText(value)}
        min={field.minimum}
        max={field.maximum}
        minLength={field.minLength}
        maxLength={field.maxLength}
        onChange={(event) =>
          setValue(
            field.control === "number" || field.control === "integer"
              ? Number(event.target.value)
              : field.control === "datetime" && event.target.value
                ? new Date(event.target.value).toISOString()
                : event.target.value,
          )
        }
      />
      {field.description && <small>{field.description}</small>}
    </label>
  );
}
