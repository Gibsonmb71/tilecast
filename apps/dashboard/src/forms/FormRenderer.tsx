import { useId } from "react";
import type { FormField, FormSchema } from "../api/types";
import { isPresentationControl } from "./formSchema";

// FormValues maps a field key to its current value. Multi-select uses string[]; others use string
// or boolean. The renderer is deliberately the single place that interprets controls so builder
// preview, submission, and review pages render identically.
export type FormValues = Record<string, string | string[] | boolean | undefined>;

export type FormRendererProps = {
  schema: FormSchema;
  values?: FormValues;
  readOnly?: boolean;
  onChange?: (key: string, value: string | string[] | boolean) => void;
  errors?: Record<string, string>;
};

export function FormRenderer({
  schema,
  values = {},
  readOnly = false,
  onChange,
  errors = {},
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
}: {
  field: FormField;
  scope: string;
  value: string | string[] | boolean | undefined;
  readOnly: boolean;
  onChange?: (key: string, value: string | string[] | boolean) => void;
  error?: string;
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
}: {
  field: FormField;
  id: string;
  describedBy?: string;
  value: string | string[] | boolean | undefined;
  readOnly: boolean;
  onChange?: (key: string, next: string | string[] | boolean) => void;
  }) {
  const disabled = readOnly || !onChange;
  const emit = (next: string | string[] | boolean) => onChange?.(field.key, next);
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
        <div className="form-renderer__multi" role="group" aria-describedby={describedBy}>
          {(field.options ?? []).map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
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

export { isPresentationControl };
