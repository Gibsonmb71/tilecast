/**
 * Declarative (v13) presentation → render-tree projection.
 *
 * Walks a PresentationNode tree, resolving data bindings, repeats,
 * conditionals, and typed formatting against normalized datasets. This is the
 * forward-looking rendering path: new release-defined widgets ship as node
 * trees and render here with no player update. Unknown node types degrade to
 * an empty box rather than failing the whole presentation.
 */

import { formatValue, safeColor, type ValueFormat } from "./format";
import { qrDataUri } from "./qr";
import type { NormalizedSource } from "./datasource";
import type {
  PresentationBinding,
  PresentationCondition,
  PresentationNode,
} from "./content-types";
import type { BoxStyle, RenderNode, TextStyle } from "./render-tree";

export interface PresentationContext {
  datasets: Map<string, NormalizedSource>;
  at: Date;
  /** Current repeat record and index, set while expanding a repeat. */
  record?: Record<string, string>;
  repeatIndex?: number;
}

function styleFromProps(props: Record<string, unknown>): BoxStyle {
  const style: BoxStyle = {};
  if (typeof props["background"] === "string")
    style.background = safeColor(props["background"], "#0E141B");
  if (typeof props["color"] === "string")
    style.color = safeColor(props["color"], "#F5F7FA");
  if (Number.isFinite(Number(props["padding"])))
    style.padding = Number(props["padding"]);
  if (Number.isFinite(Number(props["gap"]))) style.gap = Number(props["gap"]);
  if (Number.isFinite(Number(props["radius"])))
    style.radius = Number(props["radius"]);
  if (Number.isFinite(Number(props["opacity"])))
    style.opacity = Number(props["opacity"]);
  const justify = props["justify"];
  if (typeof justify === "string")
    style.justify = justify as BoxStyle["justify"];
  const align = props["align"];
  if (typeof align === "string") style.align = align as BoxStyle["align"];
  return style;
}

function textStyleFromProps(props: Record<string, unknown>): TextStyle {
  const style: TextStyle = {};
  if (typeof props["color"] === "string")
    style.color = safeColor(props["color"], "#F5F7FA");
  if (Number.isFinite(Number(props["fontSize"])))
    style.fontSize = Number(props["fontSize"]);
  if (Number.isFinite(Number(props["fontWeight"])))
    style.fontWeight = Number(props["fontWeight"]);
  const align = props["align"] ?? props["textAlign"];
  if (align === "left" || align === "center" || align === "right")
    style.align = align;
  if (Number.isFinite(Number(props["maxLines"])))
    style.maxLines = Number(props["maxLines"]);
  return style;
}

/** Resolve a binding to a display string in the current context. */
export function resolveBinding(
  binding: PresentationBinding | null | undefined,
  ctx: PresentationContext,
): string {
  if (!binding) {
    return "";
  }
  let raw: string | number | null | undefined;
  switch (binding.source) {
    case "literal":
      raw = binding.value ?? "";
      break;
    case "repeat":
      raw = ctx.record?.[binding.path ?? ""] ?? "";
      break;
    case "repeat_index":
      raw = (ctx.repeatIndex ?? 0) + 1;
      break;
    case "environment":
      raw = resolveEnvironment(binding.path ?? "", ctx.at);
      break;
    case "dataset": {
      const source = ctx.datasets.get(datasetId(binding.dataset ?? ""));
      raw = resolveDatasetPath(source, binding);
      break;
    }
    default:
      raw = "";
  }
  const formatted = formatValue(raw ?? "", {
    format: (binding.format || "text") as ValueFormat,
    precision: binding.precision ?? 0,
    prefix: binding.prefix,
    suffix: binding.suffix,
    timezone: "UTC",
  });
  return formatted === "" ? (binding.fallback ?? "") : formatted;
}

function datasetId(ref: string): string {
  return ref.includes(":") ? ref.slice(0, ref.indexOf(":")) : ref;
}

function resolveDatasetPath(
  source: NormalizedSource | undefined,
  binding: PresentationBinding,
): string {
  if (!source) {
    return "";
  }
  // A path like "0.title" or "title" (first record). Repeats bind via record.
  const path = binding.path ?? "";
  const parts = path.split(".");
  let index = 0;
  let field = path;
  if (parts.length === 2 && /^\d+$/.test(parts[0]!)) {
    index = Number(parts[0]);
    field = parts[1]!;
  }
  const record = source.records[index];
  if (!record) {
    return "";
  }
  if (binding.fields && binding.fields.length > 0) {
    return binding.fields
      .map((f) => record.fields[f] ?? "")
      .filter(Boolean)
      .join(binding.separator || " ");
  }
  return record.fields[field] ?? "";
}

function resolveEnvironment(path: string, at: Date): string {
  switch (path) {
    case "date":
      return at.toISOString().slice(0, 10);
    case "time":
      return at.toISOString().slice(11, 16);
    case "datetime":
      return at.toISOString();
    default:
      return "";
  }
}

function evaluateCondition(
  condition: PresentationCondition,
  ctx: PresentationContext,
): boolean {
  const left = resolveBinding(condition.binding, ctx);
  const right = condition.value ?? "";
  const ln = Number(left);
  const rn = Number(right);
  const numeric = Number.isFinite(ln) && Number.isFinite(rn);
  switch (condition.op) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "empty":
      return left === "";
    case "not_empty":
      return left !== "";
    case "greater_than":
      return numeric ? ln > rn : left > right;
    case "greater_or_equal":
      return numeric ? ln >= rn : left >= right;
    case "less_than":
      return numeric ? ln < rn : left < right;
    case "less_or_equal":
      return numeric ? ln <= rn : left <= right;
    case "before":
      return Date.parse(left) < Date.parse(right);
    case "after":
      return Date.parse(left) > Date.parse(right);
    default:
      return true;
  }
}

const MAX_NODES = 500;

/** Project a presentation node tree into a render tree. */
export function renderPresentation(
  root: PresentationNode,
  ctx: PresentationContext,
): RenderNode | null {
  let budget = MAX_NODES;
  const project = (
    node: PresentationNode,
    local: PresentationContext,
  ): RenderNode[] => {
    if (budget-- <= 0) {
      return [];
    }
    // Conditional gate.
    if (node.condition && !evaluateCondition(node.condition, local)) {
      return [];
    }
    // Repeat expansion: emit one subtree per record.
    if (node.repeat) {
      const source = local.datasets.get(datasetId(node.repeat.dataset));
      const records = (source?.records ?? []).slice(
        0,
        Math.max(1, node.repeat.limit),
      );
      const out: RenderNode[] = [];
      records.forEach((record, i) => {
        const child = projectSelf(node, {
          ...local,
          record: record.fields,
          repeatIndex: i,
        });
        if (child) {
          out.push(child);
        }
      });
      return out;
    }
    const self = projectSelf(node, local);
    return self ? [self] : [];
  };

  const projectSelf = (
    node: PresentationNode,
    local: PresentationContext,
  ): RenderNode | null => {
    const props = node.props ?? {};
    const children = (node.children ?? []).flatMap((c) => project(c, local));

    switch (node.type) {
      case "surface":
      case "box":
      case "stack":
        return { t: "box", style: styleFromProps(props), children };
      case "row":
        return {
          t: "box",
          style: { ...styleFromProps(props), direction: "row" },
          children,
        };
      case "column":
      case "grouped_sections":
        return {
          t: "box",
          style: { ...styleFromProps(props), direction: "column" },
          children,
        };
      case "grid": {
        const cols = Number(props["columns"]) || 2;
        return {
          t: "box",
          style: { ...styleFromProps(props), columns: `repeat(${cols}, 1fr)` },
          children,
        };
      }
      case "repeat":
      case "conditional":
        // Wrapper node whose effect is its expanded children.
        return {
          t: "box",
          style: { ...styleFromProps(props), direction: "column" },
          children,
        };
      case "spacer":
        return { t: "spacer", grow: Number(props["grow"]) || 1 };
      case "divider":
        return {
          t: "divider",
          color: safeColor(String(props["color"] ?? ""), "#2A3644"),
          vertical: props["vertical"] === true,
        };
      case "text":
      case "badge": {
        const value = node.binding
          ? resolveBinding(node.binding, local)
          : String(props["text"] ?? "");
        return { t: "text", value, style: textStyleFromProps(props) };
      }
      case "icon":
        return {
          t: "text",
          value: String(props["glyph"] ?? "•"),
          style: textStyleFromProps(props),
        };
      case "asset_image": {
        const assetId = node.binding
          ? resolveBinding(node.binding, local)
          : String(props["assetId"] ?? "");
        const variantId = String(props["variantId"] ?? "");
        if (!assetId) {
          return null;
        }
        return {
          t: "image",
          src: `tcmedia://variant/${assetId}/${variantId}`,
          fit: String(props["fit"] ?? "contain"),
        };
      }
      case "qr_code": {
        const value = node.binding
          ? resolveBinding(node.binding, local)
          : String(props["value"] ?? "");
        return {
          t: "qr",
          src: qrDataUri(
            value,
            safeColor(String(props["foreground"] ?? ""), "#000000"),
            safeColor(String(props["background"] ?? ""), "#FFFFFF"),
          ),
        };
      }
      case "progress": {
        const ratio = Math.min(Math.max(Number(props["value"]) || 0, 0), 1);
        return {
          t: "progress",
          ratio,
          color: safeColor(String(props["color"] ?? ""), "#4C8BF5"),
          track: safeColor(String(props["track"] ?? ""), "#2A3644"),
        };
      }
      case "marquee": {
        const value = node.binding
          ? resolveBinding(node.binding, local)
          : String(props["text"] ?? "");
        return {
          t: "marquee",
          text: value,
          durationMs: Number(props["durationMs"]) || 18_000,
          direction: props["direction"] === "right" ? "right" : "left",
          style: textStyleFromProps(props),
        };
      }
      case "line_chart":
      case "bar_chart":
      case "donut_chart":
        return renderChart(node, local, props);
      default:
        return { t: "box", style: {}, children };
    }
  };

  const result = project(root, ctx);
  return result[0] ?? null;
}

function renderChart(
  node: PresentationNode,
  ctx: PresentationContext,
  props: Record<string, unknown>,
): RenderNode {
  const chart =
    node.type === "bar_chart"
      ? "bar"
      : node.type === "donut_chart"
        ? "donut"
        : "line";
  const datasetRef = String(props["dataset"] ?? "");
  const source = ctx.datasets.get(
    datasetRef.includes(":")
      ? datasetRef.slice(0, datasetRef.indexOf(":"))
      : datasetRef,
  );
  const valueField = String(props["valueField"] ?? "value");
  const labelField = String(props["labelField"] ?? "label");
  const records = source?.records ?? [];
  const series = records.map((r) => Number(r.fields[valueField]) || 0);
  const labels = records.map((r) => r.fields[labelField] ?? "");
  const palette = Array.isArray(props["colors"])
    ? (props["colors"] as string[]).map((c) => safeColor(c, "#4C8BF5"))
    : ["#4C8BF5", "#34C759", "#FF9F0A", "#FF375F", "#BF5AF2"];
  return {
    t: "chart",
    chart,
    series,
    labels,
    colors: palette,
    style: styleFromProps(props),
  };
}
