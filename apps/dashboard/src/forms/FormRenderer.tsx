import { useId } from "react";
import type { FormField, FormSchema } from "../api/types";
import { isPresentationControl } from "./formSchema";

// FormValues maps a field key to its current value. Multi-select uses string[]; others use string
// or boolean. The renderer is deliberately the single place that interprets controls so builder
// preview, submission, and review pages render identically.
export type FormValues = Record<
  string,
  string | string[] | boolean | undefined
>;

// ImageFieldState describes the current image for one image field: a committed server attachment
// (contentUrl + attachmentId), a locally-selected file not yet uploaded (pendingUrl + pendingName),
// an in-flight upload, or an error. Absent means the field has no image.
export type ImageFieldState = {
  attachmentId?: string;
  contentUrl?: string;
  pendingName?: string;
  pendingUrl?: string;
  uploading?: boolean;
  error?: string;
};

// ImageHandlers wires the renderer's image fields to the owning editor, which performs the actual
// uploads/removals against a record. When provided, image fields become interactive; without it the
// renderer shows a passive placeholder (builder preview) or the committed image (read-only review).
export type ImageHandlers = {
  state: (fieldKey: string) => ImageFieldState | undefined;
  onSelect: (fieldKey: string, file: File) => void;
  onRemove: (fieldKey: string) => void;
};

export type FormRendererProps = {
  schema: FormSchema;
  values?: FormValues;
  readOnly?: boolean;
  onChange?: (key: string, value: string | string[] | boolean) => void;
  errors?: Record<string, string>;
  imageHandlers?: ImageHandlers;
};

export function FormRenderer({
  schema,
  values = {},
  readOnly = false,
  onChange,
  errors = {},
  imageHandlers,
}: FormRendererProps) {
  const scope = useId();
  return (
    <div className="form-renderer">
      {(schema.title || schema.description) && (
        <header className="form-renderer__header">
          {schema.title && (
            <h2 className="form-renderer__title">{schema.title}</h2>
          )}
          {schema.description && (
            <p className="form-renderer__description">{schema.description}</p>
          )}
        </header>
      )}
      <div className="form-renderer__fields">
        {schema.fields.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            scope={scope}
            value={values[field.key]}
            readOnly={readOnly}
            onChange={onChange}
            error={errors[field.key]}
            imageHandlers={imageHandlers}
          />
        ))}
        {schema.fields.length === 0 && (
          <p className="form-renderer__empty">This form has no fields yet.</p>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  scope,
  value,
  readOnly,
  onChange,
  error,
  imageHandlers,
}: {
  field: FormField;
  scope: string;
  value: string | string[] | boolean | undefined;
  readOnly: boolean;
  onChange?: (key: string, value: string | string[] | boolean) => void;
  error?: string;
  imageHandlers?: ImageHandlers;
}) {
  const controlId = `${scope}-${field.key}`;
  const describedBy = field.description ? `${controlId}-hint` : undefined;

  if (field.control === "section") {
    return <h3 className="form-renderer__section">{field.label}</h3>;
  }
  if (field.control === "help_text") {
    return (
      <p className="form-renderer__help">{field.description || field.label}</p>
    );
  }

  const label = (
    <span className="form-renderer__label">
      {field.label}
      {field.required && (
        <span className="form-renderer__required" aria-hidden="true">
          {" *"}
        </span>
      )}
    </span>
  );

  return (
    <div className="form-renderer__field">
      <label htmlFor={controlId}>{label}</label>
      {field.description && (
        <span id={describedBy} className="form-renderer__hint">
          {field.description}
        </span>
      )}
      <FieldControl
        field={field}
        id={controlId}
        describedBy={describedBy}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        imageHandlers={imageHandlers}
      />
      {error && (
        <span className="form-renderer__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function FieldControl({
  field,
  id,
  describedBy,
  value,
  readOnly,
  onChange,
  imageHandlers,
}: {
  field: FormField;
  id: string;
  describedBy?: string;
  value: string | string[] | boolean | undefined;
  readOnly: boolean;
  onChange?: (key: string, next: string | string[] | boolean) => void;
  imageHandlers?: ImageHandlers;
}) {
  const disabled = readOnly || !onChange;
  const emit = (next: string | string[] | boolean) =>
    onChange?.(field.key, next);
  const stringValue = typeof value === "string" ? value : "";
  const required = Boolean(field.required);

  switch (field.control) {
    case "long_text":
      return (
        <textarea
          id={id}
          aria-describedby={describedBy}
          className="input"
          rows={3}
          required={required}
          disabled={disabled}
          value={stringValue}
          maxLength={field.maxLength || undefined}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          aria-describedby={describedBy}
          disabled={disabled}
          checked={value === true || value === "true"}
          onChange={(event) => emit(event.target.checked)}
        />
      );
    case "select":
      return (
        <select
          id={id}
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "multi_select":
      return (
        <div
          id={id}
          className="form-renderer__multi"
          role="group"
          aria-label={field.label}
          aria-describedby={describedBy}
        >
          {(field.options ?? []).map((option) => {
            const selected =
              Array.isArray(value) && value.includes(option.value);
            return (
              <label key={option.value} className="checkbox-control">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected}
                  onChange={(event) => {
                    const current = Array.isArray(value) ? [...value] : [];
                    if (event.target.checked) {
                      current.push(option.value);
                    } else {
                      const index = current.indexOf(option.value);
                      if (index >= 0) current.splice(index, 1);
                    }
                    emit(current);
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      );
    case "image":
      if (imageHandlers) {
        return (
          <ImageField
            id={id}
            describedBy={describedBy}
            fieldKey={field.key}
            label={field.label}
            disabled={disabled}
            state={imageHandlers.state(field.key)}
            onSelect={imageHandlers.onSelect}
            onRemove={imageHandlers.onRemove}
          />
        );
      }
      return (
        <div className="form-renderer__image">
          <input
            id={id}
            type="file"
            accept="image/*"
            aria-describedby={describedBy}
            disabled
          />
          <span className="form-renderer__image-note">
            Image uploads are available when submitting.
          </span>
        </div>
      );
    case "number":
    case "integer":
      return (
        <input
          id={id}
          type="number"
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          step={field.control === "integer" ? 1 : "any"}
          min={field.minimum}
          max={field.maximum}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case "date":
      return (
        <input
          id={id}
          type="date"
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case "datetime":
      return (
        <input
          id={id}
          type="datetime-local"
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        />
      );
    case "url":
      return (
        <input
          id={id}
          type="url"
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        />
      );
    default:
      return (
        <input
          id={id}
          type="text"
          aria-describedby={describedBy}
          className="input"
          required={required}
          disabled={disabled}
          maxLength={field.maxLength || undefined}
          value={stringValue}
          onChange={(event) => emit(event.target.value)}
        />
      );
  }
}

// ImageField renders an interactive image control for submission and review: a preview of the
// committed or pending image with Remove/Replace, or a file picker when empty. Uploads themselves
// are performed by the owning editor through the supplied handlers.
function ImageField({
  id,
  describedBy,
  fieldKey,
  label,
  disabled,
  state,
  onSelect,
  onRemove,
}: {
  id: string;
  describedBy?: string;
  fieldKey: string;
  label: string;
  disabled: boolean;
  state?: ImageFieldState;
  onSelect: (fieldKey: string, file: File) => void;
  onRemove: (fieldKey: string) => void;
}) {
  const previewUrl = state?.pendingUrl ?? state?.contentUrl;
  const hasImage = Boolean(previewUrl);
  return (
    <div className="form-renderer__image">
      {hasImage && (
        <img
          className="form-renderer__image-preview"
          src={previewUrl}
          alt={`${label} attachment`}
        />
      )}
      {state?.uploading && (
        <span className="form-renderer__image-note">Uploading…</span>
      )}
      {state?.error && (
        <span className="form-renderer__error" role="alert">
          {state.error}
        </span>
      )}
      {!disabled && (
        <div className="form-renderer__image-actions">
          <label className="button button--secondary button--compact">
            {hasImage ? "Replace image" : "Choose image"}
            <input
              id={id}
              type="file"
              accept="image/*"
              aria-describedby={describedBy}
              aria-label={hasImage ? `Replace ${label}` : `Choose ${label}`}
              className="visually-hidden"
              disabled={state?.uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onSelect(fieldKey, file);
                event.target.value = "";
              }}
            />
          </label>
          {hasImage && (
            <button
              type="button"
              className="button button--quiet button--compact"
              disabled={state?.uploading}
              onClick={() => onRemove(fieldKey)}
            >
              Remove
            </button>
          )}
        </div>
      )}
      {!hasImage && disabled && (
        <span className="form-renderer__image-note">No image provided.</span>
      )}
    </div>
  );
}

export { isPresentationControl };
