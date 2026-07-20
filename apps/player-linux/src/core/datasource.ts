/**
 * Data-source normalization.
 *
 * Widgets and layouts consume many source shapes: v11 structured/calendar
 * prepared data, v12 typed records, and v13 DataDocument datasets. This
 * module flattens all of them into one uniform, display-ready record shape so
 * the renderers never branch on schema version. Typed formatting and offline
 * date selection are applied here (in the testable core), not in the
 * renderer.
 */

import { formatValue, type ValueFormat } from "./format";
import {
  selectByDate,
  type NoMatchBehavior,
  type SelectionMode,
} from "./selection";
import type {
  DataDocument,
  DocumentDataset,
  DocumentValue,
  ManifestDataSource,
  TypedRecordData,
} from "./content-types";

export interface NormalizedRecord {
  id: string;
  /** Extracted YYYY-MM-DD (or "") used for selection and agenda grouping. */
  date: string;
  /** Display-ready string fields, keyed by field key. */
  fields: Record<string, string>;
}

export interface NormalizedSource {
  provider: string;
  records: NormalizedRecord[];
  fieldTypes: Record<string, string>;
  attribution: string;
  unavailable: boolean;
  usingCachedData: boolean;
  /** Set when a date selection resolved to fallback text. */
  usedFallback: boolean;
  hidden: boolean;
}

function docValueToString(
  value: DocumentValue | undefined,
  fieldType?: string,
): string {
  if (!value) {
    return "";
  }
  const format = (fieldType ?? value.kind) as ValueFormat;
  switch (value.kind) {
    case "text":
      return value.text ?? "";
    case "number":
      return formatValue(value.number ?? null, {
        format: "number",
        precision: 2,
      });
    case "integer":
      return formatValue(value.integer ?? null, { format: "integer" });
    case "percent":
      return formatValue(value.number ?? value.integer ?? null, {
        format: "percent",
      });
    case "currency":
      return formatValue(value.number ?? value.integer ?? null, {
        format: "currency",
        precision: 2,
      });
    case "boolean":
      return value.boolean ? "Yes" : "No";
    case "date":
      return value.date ?? "";
    case "datetime":
      return value.datetime ?? "";
    case "duration":
      return formatValue(value.durationSeconds ?? null, { format: "duration" });
    case "url":
      return value.url ?? "";
    case "asset":
      return value.assetId ?? "";
    default:
      // list/object collapse to their text if present.
      return value.text ?? formatValue(value.number ?? null, { format });
  }
}

/** Pull a YYYY-MM-DD from a value that may be a date, datetime, or string. */
function extractDate(raw: string): string {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1]! : "";
}

function normalizeDocumentRecords(dataset: DocumentDataset): {
  records: NormalizedRecord[];
  fieldTypes: Record<string, string>;
} {
  const fieldTypes: Record<string, string> = {};
  for (const f of dataset.fields ?? []) {
    fieldTypes[f.key] = f.type;
  }
  const dateField = dataset.dateSelection?.field ?? "date";
  const records = (dataset.records ?? []).map((r) => {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(r.values)) {
      fields[key] = docValueToString(value, fieldTypes[key]);
    }
    const dateRaw = fields[dateField] ?? "";
    return { id: r.id, date: extractDate(dateRaw), fields };
  });
  return { records, fieldTypes };
}

function firstRecordsDataset(doc: DataDocument): DocumentDataset | undefined {
  return (
    doc.datasets.find((d) => d.kind === "records") ??
    doc.datasets.find((d) => (d.records?.length ?? 0) > 0)
  );
}

/** Normalize any manifest data source into uniform records. */
export function normalizeSource(
  source: ManifestDataSource,
  at: Date,
): NormalizedSource {
  const base: NormalizedSource = {
    provider: source.provider,
    records: [],
    fieldTypes: {},
    attribution: "",
    unavailable: false,
    usingCachedData: false,
    usedFallback: false,
    hidden: false,
  };

  // v13 DataDocument.
  if (source.dataDocument) {
    const dataset = firstRecordsDataset(source.dataDocument);
    if (dataset) {
      const { records, fieldTypes } = normalizeDocumentRecords(dataset);
      base.records = records;
      base.fieldTypes = fieldTypes;
      base.attribution = dataset.attribution ?? "";
      applySelection(
        base,
        dataset.dateSelection,
        dataset.timezone ?? "UTC",
        at,
      );
      return base;
    }
  }

  const config = source.configuration ?? {};

  // Calendar prepared data (v11).
  if (source.provider === "calendar" && isObject(config["data"])) {
    const events = asArray(
      (config["data"] as Record<string, unknown>)["events"],
    );
    base.records = events.map((e) => {
      const ev = e as Record<string, unknown>;
      return {
        id: String(ev["id"] ?? ""),
        date: extractDate(String(ev["start"] ?? "")),
        fields: {
          title: String(ev["title"] ?? ""),
          start: String(ev["start"] ?? ""),
          end: String(ev["end"] ?? ""),
          location: String(ev["location"] ?? ""),
          description: String(ev["descriptionExcerpt"] ?? ""),
        },
      };
    });
    return base;
  }

  // Structured prepared data (v11).
  if (isObject(config["data"])) {
    const recs = asArray(
      (config["data"] as Record<string, unknown>)["records"],
    );
    base.records = recs.map((r) => {
      const rec = r as Record<string, unknown>;
      const fields: Record<string, string> = {
        title: String(rec["title"] ?? ""),
        subtitle: String(rec["subtitle"] ?? ""),
        date: String(rec["date"] ?? ""),
        author: String(rec["author"] ?? ""),
        description: String(rec["description"] ?? ""),
        link: String(rec["link"] ?? ""),
      };
      for (const [k, v] of Object.entries(
        (rec["values"] as Record<string, unknown>) ?? {},
      )) {
        fields[k] = String(v);
      }
      return {
        id: String(rec["id"] ?? ""),
        date: extractDate(fields["date"]!),
        fields,
      };
    });
    const sel = config["dateSelection"] as Record<string, unknown> | undefined;
    if (sel?.["enabled"]) {
      applySelection(
        base,
        {
          mode: String(sel["mode"] ?? "today"),
          field: "date",
          customStartDate: String(sel["customStartDate"] ?? ""),
          customEndDate: String(sel["customEndDate"] ?? ""),
          excludePast: sel["excludePast"] === true,
          noMatchBehavior: String(sel["noMatchBehavior"] ?? "empty"),
        },
        String(sel["timezone"] ?? "UTC"),
        at,
      );
    }
    return base;
  }

  // Typed records (v12).
  const typed = config as unknown as TypedRecordData;
  if (Array.isArray(typed.records)) {
    for (const f of typed.fields ?? []) {
      base.fieldTypes[f.key] = f.type;
    }
    const dateField = typed.dateField || "date";
    base.records = typed.records.map((r) => ({
      id: r.id,
      date: extractDate(String(r.values[dateField] ?? "")),
      fields: { ...r.values },
    }));
    base.attribution = typed.attribution ?? "";
    base.unavailable = typed.unavailable === true;
  }
  return base;
}

function applySelection(
  base: NormalizedSource,
  selection:
    | {
        mode: string;
        field: string;
        customStartDate?: string;
        customEndDate?: string;
        excludePast?: boolean;
        noMatchBehavior?: string;
      }
    | null
    | undefined,
  timezone: string,
  at: Date,
): void {
  if (!selection) {
    return;
  }
  const result = selectByDate(base.records, {
    mode: selection.mode as SelectionMode,
    timezone,
    at,
    customStart: selection.customStartDate,
    customEnd: selection.customEndDate,
    excludePast: selection.excludePast,
    noMatchBehavior: selection.noMatchBehavior as NoMatchBehavior,
  });
  base.records = result.records;
  base.usedFallback = result.usedFallback;
  base.hidden = result.hidden;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
