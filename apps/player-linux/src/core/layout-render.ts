/**
 * Multi-zone Layout → render payload projection.
 *
 * Each placement becomes an absolutely-positioned zone on the canvas.
 * Widget/primitive placements resolve to render trees; asset placements to a
 * cached image/video; playlist zones carry their own item list that the
 * renderer rotates independently. A single bad placement is isolated (skipped)
 * rather than failing the whole layout; a grossly invalid document returns
 * null so the previously active presentation stays up.
 */

import { safeColor } from "./format";
import { normalizeSource } from "./datasource";
import { renderWidget } from "./widget-render";
import type {
  LayoutDocument,
  LayoutPlacement,
  LayoutPrimitive,
  ManifestDataSource,
  ManifestWidget,
} from "./content-types";
import type {
  Manifest,
  ManifestAsset,
  ManifestPlaylist,
} from "./types";
import type {
  LayoutPlaylistItem,
  LayoutRenderPayload,
  LayoutZone,
  RenderNode,
} from "./render-tree";

const FONT_WHITELIST = new Set(["Inter", "Roboto", "Source Sans 3", "Noto Sans"]);

export interface LayoutRenderContext {
  manifest: Manifest;
  widgets: Map<string, ManifestWidget>;
  dataSources: Map<string, ManifestDataSource>;
  at: Date;
}

function assetVariant(manifest: Manifest, assetId: string): ManifestAsset | undefined {
  return manifest.assets.find((a) => a.assetId === assetId);
}

function mediaSrc(asset: ManifestAsset): string {
  return `tcmedia://variant/${asset.assetId}/${asset.variantId}`;
}

export function renderLayout(
  document: LayoutDocument,
  ctx: LayoutRenderContext,
): LayoutRenderPayload | null {
  if (document.schemaVersion !== 2 || !document.canvas) {
    return null;
  }
  const { canvas } = document;
  if (!(canvas.width > 0) || !(canvas.height > 0)) {
    return null;
  }

  const zones: LayoutZone[] = [];
  const ordered = [...document.placements].sort((a, b) => a.layer - b.layer);
  for (const placement of ordered) {
    if (!placement.visible) {
      continue;
    }
    // Group primitives are containers only; their children draw themselves.
    if (placement.type === "primitive" && placement.primitive?.kind === "group") {
      continue;
    }
    const zone = renderPlacement(placement, ctx);
    if (zone) {
      zones.push(zone);
    }
  }

  let backgroundImage: string | undefined;
  if (canvas.backgroundAssetId) {
    const asset = assetVariant(ctx.manifest, canvas.backgroundAssetId);
    if (asset) {
      backgroundImage = mediaSrc(asset);
    }
  }

  return {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    background: safeColor(canvas.backgroundColor, "#000000"),
    backgroundImage,
    zones,
  };
}

function renderPlacement(
  placement: LayoutPlacement,
  ctx: LayoutRenderContext,
): LayoutZone | null {
  const base: Omit<LayoutZone, "render" | "image" | "playlistItems"> = {
    id: placement.id,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    layer: placement.layer,
    opacity: clamp01(placement.opacity),
  };

  switch (placement.type) {
    case "widget": {
      const widget = placement.widgetId ? ctx.widgets.get(placement.widgetId) : undefined;
      if (!widget) {
        return null;
      }
      const payload = renderWidget(widget, {
        dataSources: ctx.dataSources,
        at: ctx.at,
        zoneHeight: placement.height,
      });
      if (!payload) {
        return null;
      }
      return { ...base, render: payload.root };
    }
    case "asset": {
      const asset = placement.assetId ? assetVariant(ctx.manifest, placement.assetId) : undefined;
      if (!asset) {
        return null;
      }
      const fit = placement.playback?.fit ?? "contain";
      if (asset.mimeType.startsWith("video/")) {
        return {
          ...base,
          playlistItems: [
            {
              id: placement.id,
              kind: "video",
              src: mediaSrc(asset),
              durationMs: null,
              fit,
              muted: placement.playback?.muted ?? true,
              loop: placement.playback?.loop ?? true,
            },
          ],
        };
      }
      return { ...base, image: { src: mediaSrc(asset), fit } };
    }
    case "playlistZone": {
      const playlist = findPlaylist(ctx.manifest, placement.playlistId ?? null);
      if (!playlist) {
        return null;
      }
      const items = buildZoneItems(playlist, ctx.manifest, placement);
      if (items.length === 0) {
        return null;
      }
      return { ...base, playlistItems: items };
    }
    case "primitive": {
      if (!placement.primitive) {
        return null;
      }
      const node = renderPrimitive(placement.primitive, ctx, placement);
      if (!node) {
        return null;
      }
      return { ...base, render: node, radius: placement.primitive.cornerRadius };
    }
    default:
      return null;
  }
}

function buildZoneItems(
  playlist: ManifestPlaylist,
  manifest: Manifest,
  placement: LayoutPlacement,
): LayoutPlaylistItem[] {
  const items: LayoutPlaylistItem[] = [];
  for (const item of playlist.items) {
    if (item.layoutId || item.assetType === "website") {
      continue; // nested layouts / websites not supported inside a zone
    }
    const asset = manifest.assets.find(
      (a) => a.assetId === item.assetId && a.variantId === item.variantId,
    );
    if (!asset) {
      continue;
    }
    const kind = asset.mimeType.startsWith("video/")
      ? "video"
      : asset.mimeType.startsWith("image/")
        ? "image"
        : null;
    if (!kind) {
      continue;
    }
    items.push({
      id: item.id,
      kind,
      src: `tcmedia://variant/${asset.assetId}/${asset.variantId}`,
      durationMs: item.durationMs ?? (kind === "image" ? 10_000 : null),
      fit: item.fitMode || placement.playback?.fit || "contain",
      muted: !item.audioEnabled,
      loop: playlist.items.length === 1,
    });
  }
  return items;
}

function findPlaylist(manifest: Manifest, id: string | null): ManifestPlaylist | null {
  if (!id) {
    return null;
  }
  if (manifest.playlist?.id === id) return manifest.playlist;
  if (manifest.directFallbackPlaylist?.id === id) return manifest.directFallbackPlaylist;
  return (manifest.playlists ?? []).find((p) => p.id === id) ?? null;
}

function renderPrimitive(
  primitive: LayoutPrimitive,
  ctx: LayoutRenderContext,
  placement: LayoutPlacement,
): RenderNode | null {
  switch (primitive.kind) {
    case "text": {
      const value = resolvePrimitiveText(primitive, ctx);
      if (value === null) {
        return null; // hideWhenEmpty with no data
      }
      const family = FONT_WHITELIST.has(primitive.fontFamily ?? "")
        ? primitive.fontFamily
        : "Inter";
      return {
        t: "text",
        value,
        style: {
          color: safeColor(primitive.color, "#FFFFFF"),
          background: safeColor(primitive.backgroundColor, "#00000000"),
          fontSize: primitive.fontSize ?? 48,
          fontWeight: primitive.fontWeight ?? 400,
          fontFamily: family,
          align: (primitive.textAlign as "left" | "center" | "right") ?? "left",
          verticalAlign: (primitive.verticalAlign as "top" | "center" | "bottom") ?? "center",
          lineHeight: primitive.lineHeight ?? 1.2,
          letterSpacing: primitive.letterSpacing ?? 0,
          maxLines: primitive.maximumLines ?? 4,
          autoFit: primitive.autoFit ?? false,
          minFontSize: primitive.minimumFontSize ?? 8,
          padding: primitive.padding ?? 0,
          radius: primitive.cornerRadius ?? 0,
          borderWidth: primitive.borderWidth ?? 0,
          borderColor: safeColor(primitive.borderColor, "#00000000"),
        },
      };
    }
    case "rectangle":
    case "circle":
      return {
        t: "shape",
        shape: primitive.kind,
        style: {
          fill: safeColor(primitive.fillColor, "#00000000"),
          stroke: safeColor(primitive.strokeColor, "#FFFFFF"),
          strokeWidth: primitive.strokeWidth ?? 0,
          radius: primitive.cornerRadius ?? 0,
        },
      };
    case "line":
      return {
        t: "shape",
        shape: "line",
        style: {
          stroke: safeColor(primitive.strokeColor, "#FFFFFF"),
          strokeWidth: primitive.strokeWidth ?? 1,
        },
      };
    default:
      return null;
  }
  void placement;
}

function resolvePrimitiveText(
  primitive: LayoutPrimitive,
  ctx: LayoutRenderContext,
): string | null {
  const binding = primitive.binding;
  if (!binding) {
    return primitive.text ?? "";
  }
  const source = ctx.dataSources.get(binding.dataSourceId);
  const record = source
    ? // Normalize lazily here would be ideal; layout bindings read the first
      // record's well-known fields, matching the Android LayoutPrimitiveRenderer.
      firstRecordFields(source, ctx.at)
    : null;
  const value = record ? record[binding.field] ?? "" : "";
  if (!value) {
    if (binding.hideWhenEmpty) {
      return null;
    }
    return binding.fallbackText ?? "";
  }
  return `${binding.prefix ?? ""}${value}${binding.suffix ?? ""}`;
}

function firstRecordFields(
  source: ManifestDataSource,
  at: Date,
): Record<string, string> | null {
  const normalized = normalizeSource(source, at);
  return normalized.records[0]?.fields ?? null;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
