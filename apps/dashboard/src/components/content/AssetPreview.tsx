import {
  CalendarDays,
  Clock3,
  FileImage,
  FileVideo,
  Globe2,
  Library,
  QrCode,
  Youtube,
} from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { Asset, YouTubeConfig } from "../../api/types";

function widgetValue(asset: Asset) {
  const provider = asset.widget?.provider;
  const config = (asset.widget?.configuration ?? {}) as Record<string, unknown>;

  if (provider === "clock") {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: typeof config.timezone === "string" ? config.timezone : "UTC",
    }).format(new Date());
  }
  if (provider === "date") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: typeof config.timezone === "string" ? config.timezone : "UTC",
    }).format(new Date());
  }
  if (provider === "qrcode" && typeof config.label === "string") {
    return config.label || "QR code";
  }
  if (provider === "website") {
    return asset.website?.displayUrl ?? asset.name;
  }
  return asset.name;
}

function WidgetIcon({ provider }: { provider?: string }) {
  if (provider === "youtube") return <Youtube size={22} />;
  if (provider === "clock") return <Clock3 size={22} />;
  if (provider === "date") return <CalendarDays size={22} />;
  if (provider === "qrcode") return <QrCode size={22} />;
  if (["ticker", "menu", "list", "table", "agenda"].includes(provider ?? "")) {
    return <Library size={22} />;
  }
  return <Globe2 size={22} />;
}

function WidgetPreview({ asset }: { asset: Asset }) {
  const provider = asset.widget?.provider;
  const config = (asset.widget?.configuration ?? {}) as Record<string, unknown>;
  const style = {
    "--asset-widget-background":
      typeof config.backgroundColor === "string"
        ? config.backgroundColor
        : "var(--tc-bg-elevated)",
    "--asset-widget-foreground":
      typeof config.foregroundColor === "string"
        ? config.foregroundColor
        : "var(--tc-text-primary)",
  } as CSSProperties;

  return (
    <span className="asset-widget-preview" style={style}>
      <span className="asset-widget-preview__topline">
        <WidgetIcon provider={provider} />
        <span>{provider ?? "Widget"}</span>
      </span>
      <strong>{widgetValue(asset)}</strong>
      {["ticker", "menu", "list", "table", "agenda"].includes(
        provider ?? "",
      ) && (
        <span className="asset-widget-preview__rows" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

export function AssetPreview({ asset }: { asset: Asset }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const youtube = asset.widget?.provider === "youtube";
  const videoId = youtube
    ? (asset.widget?.configuration as YouTubeConfig).videoId
    : undefined;
  const imageUrl = videoId
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    : asset.thumbnailUrl;

  if (imageUrl && imageUrl !== failedImageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        referrerPolicy={videoId ? "origin" : undefined}
        onError={() => setFailedImageUrl(imageUrl)}
      />
    );
  }
  if (asset.type === "widget") return <WidgetPreview asset={asset} />;
  if (asset.type === "video") return <FileVideo size={28} />;
  return <FileImage size={28} />;
}
