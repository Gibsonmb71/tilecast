import type {
  FormDataSource,
  FormField,
  FormFieldControl,
  FormSchema,
} from "../api/types";
import { uniqueKey } from "./formKeys";

// ControlMeta centralizes how each field control behaves so the palette, editor, renderer, and
// publish-lock logic stay in agreement. outputType mirrors the server's outputTypeFor mapping;
// presentation controls (section, help_text) produce no output field.
export type ControlMeta = {
  control: FormFieldControl;
  label: string;
  description: string;
  presentation: boolean;
  outputType: string | null;
  hasOptions: boolean;
  numericBounds: boolean;
  lengthBounds: boolean;
};

export const CONTROLS: ControlMeta[] = [
  {
    control: "short_text",
    label: "Short text",
    description: "A single line of text.",
    presentation: false,
    outputType: "text",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: true,
  },
  {
    control: "long_text",
    label: "Long text",
    description: "A multi-line paragraph.",
    presentation: false,
    outputType: "text",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: true,
  },
  {
    control: "number",
    label: "Number",
    description: "A decimal number.",
    presentation: false,
    outputType: "number",
    hasOptions: false,
    numericBounds: true,
    lengthBounds: false,
  },
  {
    control: "integer",
    label: "Integer",
    description: "A whole number.",
    presentation: false,
    outputType: "integer",
    hasOptions: false,
    numericBounds: true,
    lengthBounds: false,
  },
  {
    control: "boolean",
    label: "Yes / no",
    description: "A checkbox toggle.",
    presentation: false,
    outputType: "boolean",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "select",
    label: "Select",
    description: "Choose one option.",
    presentation: false,
    outputType: "text",
    hasOptions: true,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "multi_select",
    label: "Multi-select",
    description: "Choose one or more options.",
    presentation: false,
    outputType: "text",
    hasOptions: true,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "date",
    label: "Date",
    description: "A calendar date.",
    presentation: false,
    outputType: "date",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "datetime",
    label: "Date & time",
    description: "A date with a time.",
    presentation: false,
    outputType: "datetime",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "url",
    label: "URL",
    description: "A web link.",
    presentation: false,
    outputType: "url",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "image",
    label: "Image upload",
    description: "An uploaded image.",
    presentation: false,
    outputType: "asset",
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "section",
    label: "Section heading",
    description: "A heading to group fields.",
    presentation: true,
    outputType: null,
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
  {
    control: "help_text",
    label: "Help text",
    description: "Guidance shown to submitters.",
    presentation: true,
    outputType: null,
    hasOptions: false,
    numericBounds: false,
    lengthBounds: false,
  },
];

const CONTROL_BY_ID = new Map(CONTROLS.map((meta) => [meta.control, meta]));

export function controlMeta(control: FormFieldControl): ControlMeta {
  return CONTROL_BY_ID.get(control) ?? CONTROLS[0]!;
}

export function outputTypeFor(control: FormFieldControl): string | null {
  return controlMeta(control).outputType;
}

export function isPresentationControl(control: FormFieldControl): boolean {
  return controlMeta(control).presentation;
}

// newField builds a sensible default field for a control, with a unique key derived from a label.
export function newField(
  control: FormFieldControl,
  existingKeys: Iterable<string>,
): FormField {
  const meta = controlMeta(control);
  const label = meta.presentation
    ? control === "section"
      ? "Section"
      : "Help text"
    : meta.label;
  const field: FormField = {
    key: uniqueKey(label, existingKeys),
    label,
    control,
  };
  if (meta.hasOptions) {
    field.options = [
      { value: "option_1", label: "Option 1" },
      { value: "option_2", label: "Option 2" },
    ];
  }
  return field;
}

// publishedOutputKeys returns key -> output type for every output-producing field in the current
// published revision. The builder uses it to lock keys and output-changing control swaps.
export function publishedOutputKeys(
  form: FormDataSource | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  const schema = form?.publishedRevision?.schema;
  if (!schema) {
    return result;
  }
  for (const field of schema.fields) {
    const type = outputTypeFor(field.control);
    if (type) {
      result.set(field.key, type);
    }
  }
  return result;
}

// controlsProducingOutputType lists the controls a locked field may switch between (same output
// type), so a published "short_text" can become "select" but never "number".
export function controlsWithOutputType(outputType: string): FormFieldControl[] {
  return CONTROLS.filter((meta) => meta.outputType === outputType).map(
    (meta) => meta.control,
  );
}

export const INITIAL_FORM_SCHEMA = (): FormSchema => ({
  title: "",
  description: "",
  fields: [
    { key: "title", label: "Title", control: "short_text", required: true },
  ],
});
