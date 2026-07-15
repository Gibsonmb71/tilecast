import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  LayoutDocument,
  LayoutPlacement,
  LayoutPrimitive,
} from "../api/types";

export function LayoutThumbnail({
  layoutId,
  name,
}: {
  layoutId: string;
  name: string;
}) {
  const query = useQuery({
    queryKey: ["layout-thumbnail", layoutId],
    queryFn: () => api.layout(layoutId),
    staleTime: 60_000,
  });
  const clipPrefix = useId().replaceAll(":", "");
  const document = query.data?.draft;

  if (!document) {
    return (
      <span className="layout-thumbnail layout-thumbnail--loading" aria-hidden="true">
        <span>{query.isError ? "Preview unavailable" : "Loading preview…"}</span>
      </span>
    );
  }

  return (
    <svg
      className="layout-thumbnail"
      viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Preview of ${name}`}
    >
      <rect
        width={document.canvas.width}
        height={document.canvas.height}
        fill={document.canvas.backgroundColor}
      />
      {[...document.placements]
        .filter((placement) => placement.visible)
        .sort((a, b) => a.layer - b.layer)
        .map((placement) => (
          <PlacementThumbnail
            key={placement.id}
            placement={placement}
            document={document}
            clipId={`${clipPrefix}-${placement.id}`}
          />
        ))}
    </svg>
  );
}

function PlacementThumbnail({
  placement,
  document,
  clipId,
}: {
  placement: LayoutPlacement;
  document: LayoutDocument;
  clipId: string;
}) {
  const primitive = placement.primitive;
  const opacity = Math.max(0, Math.min(1, placement.opacity));
  const common = {
    opacity,
    clipPath: `url(#${clipId})`,
  };

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect
            x={placement.x}
            y={placement.y}
            width={placement.width}
            height={placement.height}
          />
        </clipPath>
      </defs>
      {placement.type === "primitive" && primitive ? (
        <PrimitiveThumbnail
          placement={placement}
          primitive={primitive}
          common={common}
        />
      ) : (
        <ContentThumbnail placement={placement} common={common} />
      )}
      {document.canvas.safeAreaPercent > 0 && false ? <g /> : null}
    </g>
  );
}

function PrimitiveThumbnail({
  placement,
  primitive,
  common,
}: {
  placement: LayoutPlacement;
  primitive: LayoutPrimitive;
  common: { opacity: number; clipPath: string };
}) {
  if (primitive.kind === "circle") {
    return (
      <ellipse
        {...common}
        cx={placement.x + placement.width / 2}
        cy={placement.y + placement.height / 2}
        rx={placement.width / 2}
        ry={placement.height / 2}
        fill={primitive.fillColor ?? "transparent"}
        stroke={primitive.strokeColor ?? "transparent"}
        strokeWidth={primitive.strokeWidth ?? 0}
      />
    );
  }
  if (primitive.kind === "line") {
    return (
      <line
        {...common}
        x1={placement.x}
        y1={placement.y + placement.height / 2}
        x2={placement.x + placement.width}
        y2={placement.y + placement.height / 2}
        stroke={primitive.strokeColor ?? "#ffffff"}
        strokeWidth={Math.max(1, primitive.strokeWidth ?? 4)}
      />
    );
  }
  if (primitive.kind === "text") {
    const alignment = primitive.textAlign ?? "left";
    const x =
      alignment === "center"
        ? placement.x + placement.width / 2
        : alignment === "right"
          ? placement.x + placement.width
          : placement.x;
    return (
      <g {...common}>
        {primitive.backgroundColor && primitive.backgroundColor !== "#00000000" && (
          <rect
            x={placement.x}
            y={placement.y}
            width={placement.width}
            height={placement.height}
            rx={primitive.cornerRadius ?? 0}
            fill={primitive.backgroundColor}
            stroke={primitive.borderColor ?? "transparent"}
            strokeWidth={primitive.borderWidth ?? 0}
          />
        )}
        <text
          x={x}
          y={placement.y + placement.height / 2}
          fill={primitive.color ?? "#ffffff"}
          fontFamily={primitive.fontFamily ?? "Inter"}
          fontSize={Math.max(12, primitive.fontSize ?? 48)}
          fontWeight={primitive.fontWeight ?? 600}
          textAnchor={
            alignment === "center"
              ? "middle"
              : alignment === "right"
                ? "end"
                : "start"
          }
          dominantBaseline="middle"
        >
          {(primitive.text || placement.name).slice(0, 80)}
        </text>
      </g>
    );
  }
  if (primitive.kind === "group") {
    return (
      <rect
        {...common}
        x={placement.x}
        y={placement.y}
        width={placement.width}
        height={placement.height}
        fill="transparent"
        stroke="#94a3b8"
        strokeWidth={Math.max(2, placement.width / 200)}
        strokeDasharray={`${Math.max(6, placement.width / 80)} ${Math.max(4, placement.width / 120)}`}
      />
    );
  }
  return (
    <rect
      {...common}
      x={placement.x}
      y={placement.y}
      width={placement.width}
      height={placement.height}
      rx={primitive.cornerRadius ?? 0}
      fill={primitive.fillColor ?? "transparent"}
      stroke={primitive.strokeColor ?? "transparent"}
      strokeWidth={primitive.strokeWidth ?? 0}
    />
  );
}

function ContentThumbnail({
  placement,
  common,
}: {
  placement: LayoutPlacement;
  common: { opacity: number; clipPath: string };
}) {
  const fill =
    placement.type === "playlistZone"
      ? "#1d4ed8"
      : placement.type === "app"
        ? "#0f766e"
        : "#334155";
  const label =
    placement.type === "playlistZone"
      ? `Playlist · ${placement.name}`
      : placement.type === "app"
        ? `App · ${placement.name}`
        : placement.name;
  return (
    <g {...common}>
      <rect
        x={placement.x}
        y={placement.y}
        width={placement.width}
        height={placement.height}
        rx={placement.playback?.cornerRadius ?? 0}
        fill={fill}
      />
      <text
        x={placement.x + placement.width / 2}
        y={placement.y + placement.height / 2}
        fill="#f8fafc"
        fontSize={Math.max(12, Math.min(36, placement.width / 12))}
        fontWeight={600}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {label.slice(0, 48)}
      </text>
    </g>
  );
}
