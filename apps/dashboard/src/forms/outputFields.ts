import type { FormDataSource, FormSchema } from "../api/types";

export type OutputField = { key: string; label: string; type: string };

// outputTypeFor mirrors the server (apps/server/internal/forms/types.go): the typed output a form
// control exposes to views/widgets, or "" for presentation-only controls.
function outputTypeFor(control: string): string {
  switch (control) {
    case "short_text":
    case "long_text":
    case "select":
    case "multi_select":
      return "text";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "url":
      return "url";
    case "image":
      return "asset";
    default:
      return "";
  }
}

// syntheticFields are the record fields every form exposes in addition to its schema fields, matching
// outputFieldSpecs on the server.
const syntheticFields: OutputField[] = [
  { key: "state", label: "Workflow state", type: "text" },
  { key: "displayTitle", label: "Display title", type: "text" },
  { key: "priority", label: "Priority", type: "integer" },
  { key: "submittedAt", label: "Submitted time", type: "datetime" },
  { key: "displayAt", label: "Display from", type: "datetime" },
  { key: "expiresAt", label: "Expires at", type: "datetime" },
];

// availableOutputFields returns the selectable output fields for a form's published revision (falling
// back to the draft), matching what the server projects. Used to drive the Views editor's field,
// filter, and sort selectors.
export function availableOutputFields(form: FormDataSource): OutputField[] {
  const schema: FormSchema = form.publishedRevision?.schema ??
    form.draftSchema ?? { fields: [] };
  const fields: OutputField[] = [];
  for (const field of schema.fields) {
    const type = outputTypeFor(field.control);
    if (type === "") continue;
    fields.push({ key: field.key, label: field.label || field.key, type });
  }
  return [...fields, ...syntheticFields];
}

// operatorsForType returns the filter operators valid for a field type (field-aware operators), so
// the Views editor never offers an invalid filter/field combination.
export function operatorsForType(
  type: string,
): { value: string; label: string }[] {
  const base = [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "empty", label: "is empty" },
    { value: "not_empty", label: "is not empty" },
  ];
  if (
    type === "number" ||
    type === "integer" ||
    type === "date" ||
    type === "datetime"
  ) {
    return [
      ...base,
      { value: "greater_than", label: "greater than" },
      { value: "less_than", label: "less than" },
    ];
  }
  if (type === "text" || type === "url") {
    return [{ value: "contains", label: "contains" }, ...base];
  }
  return base; // boolean / asset
}

// isTimeField reports whether a field can anchor the relative time-window filter.
export function isTimeField(type: string): boolean {
  return type === "date" || type === "datetime";
}
