/**
 * Tilecast Player renderer — the display surface.
 *
 * Receives complete presentations from the main process and rotates through
 * playlist items on two crossfading layers. It reports real playback
 * progress (item transitions, advancing video time, re-shown images, healthy
 * websites) so the supervisor judges health by what is actually on screen.
 * A failing item is isolated: it reports an error and the rotation advances,
 * never wedging the loop.
 *
 * Compiled as a plain global script — no module syntax — so it runs in the
 * sandboxed page directly.
 */

// Minimal local mirror of the render-tree IR (core/render-tree.ts). The
// renderer is a dependency-free browser script, so the shape is duplicated
// here rather than imported; it is a dumb interpreter with no data logic.
interface AnyNode {
  t: string;
  [key: string]: unknown;
}

interface WidgetPayload {
  background: string;
  root: AnyNode;
}

interface LayoutZonePayload {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  opacity: number;
  radius?: number;
  render?: AnyNode;
  image?: { src: string; fit: string };
  playlistItems?: {
    id: string;
    kind: "image" | "video";
    src: string;
    durationMs: number | null;
    fit: string;
    muted: boolean;
    loop: boolean;
  }[];
}

interface LayoutPayload {
  canvasWidth: number;
  canvasHeight: number;
  background: string;
  backgroundImage?: string;
  zones: LayoutZonePayload[];
}

interface RendererItem {
  id: string;
  kind: "image" | "video" | "website" | "widget" | "layout" | "youtube";
  src: string;
  durationMs: number | null;
  fitMode: string;
  audioEnabled: boolean;
  volume: number;
  videoStartOffsetMs: number | null;
  videoEndOffsetMs: number | null;
  website?: {
    loadTimeoutSeconds: number;
    refreshIntervalSeconds: number | null;
    zoomPercent: number;
    backgroundColor: string;
    failureBehavior: string;
    fallbackSrc: string | null;
    allowedHosts: string[];
  };
  widget?: WidgetPayload;
  layout?: LayoutPayload;
}

interface RendererPresentation {
  state: string;
  items?: RendererItem[];
  generation?: number;
  emergency?: boolean;
  code?: string;
  approvalUrl?: string;
  organizationName?: string;
  title?: string;
  message?: string;
  reason?: string;
}

interface TilecastBridge {
  onPresent(callback: (presentation: RendererPresentation) => void): void;
  onIdentify(
    callback: (data: { name: string; durationSeconds: number }) => void,
  ): void;
  onRetryItem(callback: () => void): void;
  onSkipItem(callback: () => void): void;
  reportProgress(itemId: string | null, kind: string): void;
  reportPlaybackError(itemId: string | null, message: string): void;
  reportWebsiteRecovered(): void;
  submitServerUrl(url: string): Promise<{ ok: boolean; error?: string }>;
  onDiscoveredServer(
    callback: (server: { name: string; serverUrl: string }) => void,
  ): void;
  listDiscoveredServers(): Promise<{ name: string; serverUrl: string }[]>;
}

declare const tilecast: TilecastBridge;

const layerA = document.getElementById("layer-a") as HTMLDivElement;
const layerB = document.getElementById("layer-b") as HTMLDivElement;
const messageEl = document.getElementById("message") as HTMLDivElement;
const identifyEl = document.getElementById("identify") as HTMLDivElement;

let frontLayer = layerA;
let backLayer = layerB;

let items: RendererItem[] = [];
let generation = -1;
let index = 0;
let itemTimer: number | null = null;
let stillImageTicker: number | null = null;
let websiteRefreshTimer: number | null = null;
let currentItem: RendererItem | null = null;
let consecutiveFailures = 0;

const FIT_MODES: Record<string, string> = {
  contain: "contain",
  fit: "contain",
  cover: "cover",
  fill: "fill",
  stretch: "fill",
};

function clearTimers(): void {
  if (itemTimer !== null) {
    window.clearTimeout(itemTimer);
    itemTimer = null;
  }
  if (stillImageTicker !== null) {
    window.clearInterval(stillImageTicker);
    stillImageTicker = null;
  }
  if (websiteRefreshTimer !== null) {
    window.clearInterval(websiteRefreshTimer);
    websiteRefreshTimer = null;
  }
  clearNodeTimers();
}

function swapLayers(): void {
  const previousFront = frontLayer;
  frontLayer = backLayer;
  backLayer = previousFront;
  frontLayer.classList.add("visible");
  backLayer.classList.remove("visible");
  // Free decoders/webviews shortly after the fade completes.
  window.setTimeout(() => {
    if (backLayer !== frontLayer) {
      backLayer.replaceChildren();
    }
  }, 500);
}

function showMessage(html: string): void {
  clearTimers();
  currentItem = null;
  messageEl.innerHTML = html;
  messageEl.classList.add("visible");
  layerA.classList.remove("visible");
  layerB.classList.remove("visible");
  layerA.replaceChildren();
  layerB.replaceChildren();
}

function hideMessage(): void {
  messageEl.classList.remove("visible");
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ------------------------------------------------- render-tree interpreter
//
// Timers created by self-updating nodes (clock, countdown) are tracked so a
// layer swap tears them down — otherwise stale tickers would leak and keep an
// old CPU warm.
let nodeTimers: number[] = [];

function clearNodeTimers(): void {
  for (const id of nodeTimers) {
    window.clearInterval(id);
  }
  nodeTimers = [];
}

function px(value: unknown, fallback = ""): string {
  return typeof value === "number" ? `${value}px` : fallback;
}

function applyBoxStyle(el: HTMLElement, style: Record<string, unknown>): void {
  const s = el.style;
  if (style["background"]) s.background = String(style["background"]);
  if (style["color"]) s.color = String(style["color"]);
  if (typeof style["padding"] === "number") s.padding = px(style["padding"]);
  if (typeof style["gap"] === "number") s.gap = px(style["gap"]);
  if (typeof style["radius"] === "number") s.borderRadius = px(style["radius"]);
  if (typeof style["opacity"] === "number")
    s.opacity = String(style["opacity"]);
  if (typeof style["borderWidth"] === "number" && style["borderWidth"]) {
    s.border = `${px(style["borderWidth"])} solid ${String(style["borderColor"] ?? "#000")}`;
  }
  if (style["columns"]) {
    s.display = "grid";
    s.gridTemplateColumns = String(style["columns"]);
  } else {
    s.display = "flex";
    s.flexDirection = style["direction"] === "row" ? "row" : "column";
  }
  const justifyMap: Record<string, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    "space-between": "space-between",
    "space-around": "space-around",
  };
  const alignMap: Record<string, string> = {
    start: "flex-start",
    center: "center",
    end: "flex-end",
    stretch: "stretch",
  };
  if (style["justify"])
    s.justifyContent = justifyMap[String(style["justify"])] ?? "flex-start";
  if (style["align"])
    s.alignItems = alignMap[String(style["align"])] ?? "stretch";
  if (typeof style["grow"] === "number") s.flexGrow = String(style["grow"]);
  if (typeof style["width"] === "number")
    s.width = style["width"] <= 100 ? `${style["width"]}%` : px(style["width"]);
  if (typeof style["height"] === "number")
    s.height =
      style["height"] <= 100 ? `${style["height"]}%` : px(style["height"]);
  if (style["wrap"]) s.flexWrap = "wrap";
}

function applyTextStyle(el: HTMLElement, style: Record<string, unknown>): void {
  const s = el.style;
  if (style["color"]) s.color = String(style["color"]);
  if (style["background"]) s.background = String(style["background"]);
  if (typeof style["fontSize"] === "number") s.fontSize = px(style["fontSize"]);
  if (typeof style["fontWeight"] === "number")
    s.fontWeight = String(style["fontWeight"]);
  if (style["fontFamily"])
    s.fontFamily = `${String(style["fontFamily"])}, system-ui, sans-serif`;
  if (style["align"]) s.textAlign = String(style["align"]);
  if (typeof style["lineHeight"] === "number")
    s.lineHeight = String(style["lineHeight"]);
  if (typeof style["letterSpacing"] === "number")
    s.letterSpacing = px(style["letterSpacing"]);
  if (typeof style["padding"] === "number") s.padding = px(style["padding"]);
  if (typeof style["grow"] === "number") s.flexGrow = String(style["grow"]);
  if (typeof style["maxLines"] === "number" && style["maxLines"]) {
    s.display = "-webkit-box";
    s.webkitBoxOrient = "vertical";
    (s as unknown as Record<string, string>)["WebkitLineClamp"] = String(
      style["maxLines"],
    );
    s.overflow = "hidden";
  }
  const va = style["verticalAlign"];
  if (va === "top") s.alignSelf = "flex-start";
  else if (va === "bottom") s.alignSelf = "flex-end";
}

function formatClock(node: AnyNode): string {
  const now = new Date();
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: String(node["timezone"] ?? "UTC"),
      hour: "numeric",
      minute: "2-digit",
      second: node["showSeconds"] ? "2-digit" : undefined,
      hour12: node["hour12"] !== false,
    }).format(now);
  } catch {
    return now.toLocaleTimeString();
  }
}

function formatCountdown(node: AnyNode): string {
  const now = Date.now();
  const recurrence = String(node["recurrence"] ?? "none");
  const target = resolveCountdownTarget(
    String(node["target"] ?? ""),
    String(node["timezone"] ?? "UTC"),
    recurrence,
    now,
  );
  let remaining = target - now;
  const countUp = node["countUp"] === true;
  if (remaining <= 0 && !countUp && recurrence === "none") {
    const action = String(node["completionAction"] ?? "completed_text");
    if (action === "hide") return "";
    if (action === "count_up") remaining = now - target;
    else return String(node["completionText"] ?? "");
  } else if (remaining <= 0) {
    remaining = now - target;
  }
  const abs = Math.abs(remaining);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1_000);
  const parts: string[] = [];
  if (node["showDays"] !== false && days > 0) parts.push(`${days}d`);
  if (node["showHours"] !== false)
    parts.push(`${String(hours).padStart(2, "0")}h`);
  if (node["showMinutes"] !== false)
    parts.push(`${String(minutes).padStart(2, "0")}m`);
  if (node["showSeconds"] === true)
    parts.push(`${String(seconds).padStart(2, "0")}s`);
  return parts.join(" ");
}

function resolveCountdownTarget(
  target: string,
  timezone: string,
  recurrence: string,
  now: number,
): number {
  const zone = validCountdownTimezone(timezone);
  const original = parseCountdownTarget(target, zone);
  if (original === null || recurrence === "none") return original ?? now;

  const seed = countdownDateParts(original, zone);
  const current = countdownDateParts(now, zone);
  let date = countdownRecurringDate(seed, current, recurrence);
  let candidate = countdownZonedEpoch(
    { ...date, ...countdownTime(seed) },
    zone,
  );
  if (candidate <= now) {
    date = advanceCountdownDate(date, seed, recurrence);
    candidate = countdownZonedEpoch({ ...date, ...countdownTime(seed) }, zone);
  }
  return candidate;
}

interface CountdownDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

type CountdownDate = Pick<CountdownDateParts, "year" | "month" | "day">;

function validCountdownTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return "UTC";
  }
}

function parseCountdownTarget(target: string, timezone: string): number | null {
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(target)) {
    const parsed = Date.parse(target);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      target,
    );
  if (!match) return null;
  return countdownZonedEpoch(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] ?? 0),
    },
    timezone,
  );
}

function countdownDateParts(
  epochMs: number,
  timezone: string,
): CountdownDateParts {
  const values: Record<string, number> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values["year"]!,
    month: values["month"]!,
    day: values["day"]!,
    hour: values["hour"]!,
    minute: values["minute"]!,
    second: values["second"]!,
  };
}

function countdownZonedEpoch(
  parts: CountdownDateParts,
  timezone: string,
): number {
  const desired = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = countdownDateParts(candidate, timezone);
    const rendered = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = desired - rendered;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return candidate;
}

function countdownRecurringDate(
  seed: CountdownDateParts,
  current: CountdownDateParts,
  recurrence: string,
): CountdownDate {
  if (recurrence === "daily")
    return countdownDate(current.year, current.month, current.day);
  if (recurrence === "weekly") {
    const currentDay = countdownUTCDate(current).getUTCDay();
    const seedDay = countdownUTCDate(seed).getUTCDay();
    return addCountdownDays(
      countdownDate(current.year, current.month, current.day),
      (seedDay - currentDay + 7) % 7,
    );
  }
  if (recurrence === "monthly") {
    return countdownDate(
      current.year,
      current.month,
      Math.min(seed.day, countdownDaysInMonth(current.year, current.month)),
    );
  }
  return countdownDate(
    current.year,
    seed.month,
    Math.min(seed.day, countdownDaysInMonth(current.year, seed.month)),
  );
}

function advanceCountdownDate(
  date: CountdownDate,
  seed: CountdownDateParts,
  recurrence: string,
): CountdownDate {
  if (recurrence === "daily") return addCountdownDays(date, 1);
  if (recurrence === "weekly") return addCountdownDays(date, 7);
  if (recurrence === "monthly") {
    const next = new Date(Date.UTC(date.year, date.month, 1));
    return countdownDate(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      Math.min(
        seed.day,
        countdownDaysInMonth(next.getUTCFullYear(), next.getUTCMonth() + 1),
      ),
    );
  }
  return countdownDate(
    date.year + 1,
    seed.month,
    Math.min(seed.day, countdownDaysInMonth(date.year + 1, seed.month)),
  );
}

function countdownDate(
  year: number,
  month: number,
  day: number,
): CountdownDate {
  return { year, month, day };
}

function countdownTime(
  parts: CountdownDateParts,
): Pick<CountdownDateParts, "hour" | "minute" | "second"> {
  return { hour: parts.hour, minute: parts.minute, second: parts.second };
}

function addCountdownDays(parts: CountdownDate, days: number): CountdownDate {
  const value = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return countdownDate(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
  );
}

function countdownUTCDate(parts: CountdownDate): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function countdownDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildRenderNode(node: AnyNode): HTMLElement {
  switch (node["t"]) {
    case "box": {
      const el = document.createElement("div");
      applyBoxStyle(el, (node["style"] as Record<string, unknown>) ?? {});
      for (const child of (node["children"] as AnyNode[]) ?? []) {
        el.appendChild(buildRenderNode(child));
      }
      return el;
    }
    case "text": {
      const el = document.createElement("div");
      el.textContent = String(node["value"] ?? "");
      applyTextStyle(el, (node["style"] as Record<string, unknown>) ?? {});
      return el;
    }
    case "image": {
      const el = document.createElement("img");
      el.style.objectFit = FIT_MODES[String(node["fit"])] ?? "contain";
      el.style.width = "100%";
      el.style.height = "100%";
      if (typeof node["radius"] === "number")
        el.style.borderRadius = px(node["radius"]);
      el.src = String(node["src"] ?? "");
      return el;
    }
    case "qr": {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      const img = document.createElement("img");
      img.style.width = "min(70vh, 70vw)";
      img.style.height = "auto";
      img.src = String(node["src"] ?? "");
      wrap.appendChild(img);
      if (node["label"]) {
        const label = document.createElement("div");
        label.textContent = String(node["label"]);
        label.style.fontSize = "28px";
        wrap.appendChild(label);
      }
      return wrap;
    }
    case "shape": {
      const el = document.createElement("div");
      const style = (node["style"] as Record<string, unknown>) ?? {};
      el.style.width = "100%";
      el.style.height = "100%";
      if (node["shape"] === "circle") el.style.borderRadius = "50%";
      else if (typeof style["radius"] === "number")
        el.style.borderRadius = px(style["radius"]);
      if (style["fill"]) el.style.background = String(style["fill"]);
      if (style["strokeWidth"] && Number(style["strokeWidth"]) > 0) {
        el.style.border = `${px(style["strokeWidth"])} solid ${String(style["stroke"] ?? "#fff")}`;
      }
      if (node["shape"] === "line") {
        el.style.height = px(style["strokeWidth"] ?? 1);
        el.style.background = String(style["stroke"] ?? "#fff");
        el.style.border = "none";
      }
      return el;
    }
    case "progress": {
      const track = document.createElement("div");
      track.style.width = "80%";
      track.style.height = "20px";
      track.style.borderRadius = "10px";
      track.style.background = String(node["track"] ?? "#333");
      track.style.overflow = "hidden";
      const bar = document.createElement("div");
      bar.style.height = "100%";
      bar.style.width = `${Math.round(Number(node["ratio"] ?? 0) * 100)}%`;
      bar.style.background = String(node["color"] ?? "#4C8BF5");
      track.appendChild(bar);
      return track;
    }
    case "divider": {
      const el = document.createElement("div");
      if (node["vertical"]) {
        el.style.width = "1px";
        el.style.alignSelf = "stretch";
      } else {
        el.style.height = "1px";
        el.style.width = "100%";
      }
      el.style.background = String(node["color"] ?? "#2A3644");
      return el;
    }
    case "spacer": {
      const el = document.createElement("div");
      el.style.flexGrow = String(node["grow"] ?? 1);
      return el;
    }
    case "marquee":
      return buildMarquee(node);
    case "chart":
      return buildChart(node);
    case "clock": {
      const el = document.createElement("div");
      applyTextStyle(el, (node["style"] as Record<string, unknown>) ?? {});
      const tick = () => (el.textContent = formatClock(node));
      tick();
      nodeTimers.push(
        window.setInterval(tick, node["showSeconds"] ? 1_000 : 15_000),
      );
      return el;
    }
    case "countdown": {
      const el = document.createElement("div");
      applyTextStyle(el, (node["style"] as Record<string, unknown>) ?? {});
      const tick = () => (el.textContent = formatCountdown(node));
      tick();
      nodeTimers.push(
        window.setInterval(tick, node["showSeconds"] ? 1_000 : 30_000),
      );
      return el;
    }
    default: {
      const el = document.createElement("div");
      for (const child of (node["children"] as AnyNode[]) ?? []) {
        el.appendChild(buildRenderNode(child));
      }
      return el;
    }
  }
}

function buildMarquee(node: AnyNode): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.overflow = "hidden";
  wrap.style.whiteSpace = "nowrap";
  wrap.style.width = "100%";
  const track = document.createElement("div");
  track.textContent = String(node["text"] ?? "");
  applyTextStyle(track, (node["style"] as Record<string, unknown>) ?? {});
  track.style.display = "inline-block";
  track.style.paddingLeft = "100%";
  track.style.willChange = "transform";
  const dur = Math.max(Number(node["durationMs"] ?? 18_000), 4_000);
  const dir =
    node["direction"] === "right" ? "tc-marquee-right" : "tc-marquee-left";
  track.style.animation = `${dir} ${dur}ms linear infinite`;
  wrap.appendChild(track);
  return wrap;
}

function buildChart(node: AnyNode): HTMLElement {
  // Lightweight inline SVG — no chart library, no animation (kind to old GPU).
  const series = (node["series"] as number[]) ?? [];
  const colors = (node["colors"] as string[]) ?? ["#4C8BF5"];
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 100 60");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.width = "100%";
  svg.style.height = "100%";
  const max = Math.max(1, ...series.map((v) => Math.abs(v)));
  if (node["chart"] === "donut") {
    const total = series.reduce((a, b) => a + Math.abs(b), 0) || 1;
    let angle = -Math.PI / 2;
    series.forEach((v, i) => {
      const slice = (Math.abs(v) / total) * Math.PI * 2;
      const path = document.createElementNS(svgNS, "path");
      const [cx, cy, r] = [50, 30, 25];
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + slice);
      const y2 = cy + r * Math.sin(angle + slice);
      const large = slice > Math.PI ? 1 : 0;
      path.setAttribute(
        "d",
        `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      );
      path.setAttribute("fill", colors[i % colors.length]!);
      svg.appendChild(path);
      angle += slice;
    });
  } else if (node["chart"] === "bar") {
    const w = 100 / Math.max(series.length, 1);
    series.forEach((v, i) => {
      const rect = document.createElementNS(svgNS, "rect");
      const h = (Math.abs(v) / max) * 58;
      rect.setAttribute("x", String(i * w + w * 0.15));
      rect.setAttribute("y", String(60 - h));
      rect.setAttribute("width", String(w * 0.7));
      rect.setAttribute("height", String(h));
      rect.setAttribute("fill", colors[i % colors.length]!);
      svg.appendChild(rect);
    });
  } else {
    const step = 100 / Math.max(series.length - 1, 1);
    const points = series
      .map((v, i) => `${i * step},${60 - (Math.abs(v) / max) * 58}`)
      .join(" ");
    const poly = document.createElementNS(svgNS, "polyline");
    poly.setAttribute("points", points);
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", colors[0]!);
    poly.setAttribute("stroke-width", "2");
    svg.appendChild(poly);
  }
  return svg as unknown as HTMLElement;
}

// ---------------------------------------------------------------- playback

function startPlaying(presentation: RendererPresentation): void {
  hideMessage();
  items = presentation.items ?? [];
  generation = presentation.generation ?? 0;
  index = 0;
  consecutiveFailures = 0;
  clearTimers();
  if (items.length === 0) {
    return;
  }
  void renderItem(items[0]!, generation);
}

function advance(): void {
  if (items.length === 0) {
    return;
  }
  const myGeneration = generation;
  tilecast.reportProgress(currentItem?.id ?? null, "item-transition");
  // The main process may activate a pending manifest on that boundary and
  // push a fresh presentation; give that message one macrotask to land so
  // the swap is seamless rather than one item late.
  window.setTimeout(() => {
    if (generation !== myGeneration) {
      return; // a new presentation took over
    }
    index = (index + 1) % items.length;
    void renderItem(items[index]!, myGeneration);
  }, 0);
}

function failItem(item: RendererItem, message: string): void {
  tilecast.reportPlaybackError(item.id, message);
  consecutiveFailures += 1;
  const myGeneration = generation;
  // Isolate the failure and keep rotating; pause grows when everything is
  // failing so a fully broken playlist does not spin at 100% CPU.
  const delay = Math.min(
    2_000 * Math.max(consecutiveFailures - items.length, 0) + 1_000,
    30_000,
  );
  window.setTimeout(() => {
    if (generation !== myGeneration) {
      return;
    }
    index = (index + 1) % items.length;
    void renderItem(items[index]!, myGeneration);
  }, delay);
}

async function renderItem(
  item: RendererItem,
  myGeneration: number,
): Promise<void> {
  if (myGeneration !== generation) {
    return;
  }
  clearTimers();
  currentItem = item;
  const fit = FIT_MODES[item.fitMode] ?? "contain";

  if (item.kind === "image") {
    renderImage(item, fit, myGeneration);
  } else if (item.kind === "video") {
    renderVideo(item, fit, myGeneration);
  } else if (item.kind === "widget") {
    renderWidgetItem(item, myGeneration);
  } else if (item.kind === "layout") {
    renderLayoutItem(item, myGeneration);
  } else {
    // website and youtube both render in a <webview>.
    renderWebsite(item, myGeneration);
  }
}

function renderWidgetItem(item: RendererItem, myGeneration: number): void {
  const payload = item.widget;
  if (!payload) {
    failItem(item, "widget payload missing");
    return;
  }
  clearNodeTimers();
  const container = document.createElement("div");
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.background = payload.background || "#000";
  container.appendChild(buildRenderNode(payload.root));
  backLayer.replaceChildren(container);
  swapLayers();
  consecutiveFailures = 0;
  tilecast.reportProgress(item.id, "widget-shown");
  // A widget is healthy content; keep the progress heartbeat alive and, for
  // fixed-duration widget items, advance at the boundary.
  stillImageTicker = window.setInterval(() => {
    if (myGeneration === generation) {
      tilecast.reportProgress(item.id, "widget-alive");
    }
  }, 30_000);
  if (item.durationMs) {
    itemTimer = window.setTimeout(() => advance(), item.durationMs);
  }
}

function renderLayoutItem(item: RendererItem, myGeneration: number): void {
  const payload = item.layout;
  if (!payload) {
    failItem(item, "layout payload missing");
    return;
  }
  clearNodeTimers();
  const canvas = document.createElement("div");
  canvas.style.position = "relative";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.background = payload.background || "#000";
  canvas.style.overflow = "hidden";
  if (payload.backgroundImage) {
    const bg = document.createElement("img");
    bg.src = payload.backgroundImage;
    bg.style.position = "absolute";
    bg.style.inset = "0";
    bg.style.width = "100%";
    bg.style.height = "100%";
    bg.style.objectFit = "cover";
    canvas.appendChild(bg);
  }
  const w = payload.canvasWidth || 1920;
  const h = payload.canvasHeight || 1080;
  for (const zone of payload.zones) {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.left = `${(zone.x / w) * 100}%`;
    el.style.top = `${(zone.y / h) * 100}%`;
    el.style.width = `${(zone.width / w) * 100}%`;
    el.style.height = `${(zone.height / h) * 100}%`;
    el.style.opacity = String(zone.opacity ?? 1);
    el.style.overflow = "hidden";
    if (zone.radius) el.style.borderRadius = `${zone.radius}px`;
    if (zone.render) {
      el.appendChild(buildRenderNode(zone.render));
    } else if (zone.image) {
      const img = document.createElement("img");
      img.src = zone.image.src;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = FIT_MODES[zone.image.fit] ?? "contain";
      el.appendChild(img);
    } else if (zone.playlistItems && zone.playlistItems.length > 0) {
      startZonePlaylist(
        el,
        zone.playlistItems,
        () => generation === myGeneration,
      );
    }
    canvas.appendChild(el);
  }
  backLayer.replaceChildren(canvas);
  swapLayers();
  consecutiveFailures = 0;
  tilecast.reportProgress(item.id, "layout-shown");
  stillImageTicker = window.setInterval(() => {
    if (myGeneration === generation) {
      tilecast.reportProgress(item.id, "layout-alive");
    }
  }, 30_000);
  if (item.durationMs) {
    itemTimer = window.setTimeout(() => advance(), item.durationMs);
  }
}

/** Independently-rotating media loop inside a layout playlist zone. */
function startZonePlaylist(
  container: HTMLElement,
  items: LayoutZonePayload["playlistItems"],
  alive: () => boolean,
): void {
  const list = items ?? [];
  let zoneIndex = 0;
  const showNext = () => {
    if (!alive() || list.length === 0) {
      return;
    }
    const zi = list[zoneIndex % list.length]!;
    zoneIndex += 1;
    if (zi.kind === "video") {
      const video = document.createElement("video");
      video.src = zi.src;
      video.muted = zi.muted;
      video.autoplay = true;
      video.loop = zi.loop || list.length === 1;
      video.style.width = "100%";
      video.style.height = "100%";
      video.style.objectFit = FIT_MODES[zi.fit] ?? "contain";
      video.onended = () => {
        if (!video.loop) showNext();
      };
      video.onerror = () => window.setTimeout(showNext, 2_000);
      container.replaceChildren(video);
      void video.play().catch(() => window.setTimeout(showNext, 2_000));
    } else {
      const img = document.createElement("img");
      img.src = zi.src;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = FIT_MODES[zi.fit] ?? "contain";
      container.replaceChildren(img);
      if (list.length > 1) {
        window.setTimeout(showNext, zi.durationMs ?? 10_000);
      }
    }
  };
  showNext();
}

function renderImage(
  item: RendererItem,
  fit: string,
  myGeneration: number,
): void {
  const img = document.createElement("img");
  img.style.objectFit = fit;
  img.onload = () => {
    if (myGeneration !== generation || currentItem !== item) {
      return;
    }
    swapLayers();
    consecutiveFailures = 0;
    tilecast.reportProgress(item.id, "image-shown");
    // A long-lived still image is healthy; say so periodically.
    stillImageTicker = window.setInterval(() => {
      tilecast.reportProgress(item.id, "image-shown");
    }, 30_000);
    itemTimer = window.setTimeout(() => advance(), item.durationMs ?? 10_000);
  };
  img.onerror = () => {
    if (myGeneration === generation) {
      failItem(item, "image failed to load");
    }
  };
  backLayer.replaceChildren(img);
  img.src = item.src;
}

function renderVideo(
  item: RendererItem,
  fit: string,
  myGeneration: number,
): void {
  const video = document.createElement("video");
  video.style.objectFit = fit;
  video.autoplay = false;
  video.muted = !item.audioEnabled;
  video.volume = Math.min(Math.max(item.volume, 0), 1);
  video.playsInline = true;

  const startS = (item.videoStartOffsetMs ?? 0) / 1_000;
  const endS =
    item.videoEndOffsetMs !== null ? item.videoEndOffsetMs / 1_000 : null;
  let lastReportedAt = 0;
  let finished = false;

  const finish = () => {
    if (finished || myGeneration !== generation || currentItem !== item) {
      return;
    }
    finished = true;
    if (items.length === 1) {
      // Single-item loop: seamless restart without tearing down the element.
      tilecast.reportProgress(item.id, "item-transition");
      finished = false;
      video.currentTime = startS;
      void video.play().catch(() => failItem(item, "video restart failed"));
      return;
    }
    advance();
  };

  video.oncanplay = () => {
    if (myGeneration !== generation || currentItem !== item) {
      return;
    }
    if (!video.dataset.shown) {
      video.dataset.shown = "1";
      swapLayers();
      consecutiveFailures = 0;
      void video.play().catch(() => failItem(item, "video autoplay failed"));
    }
  };
  video.ontimeupdate = () => {
    if (myGeneration !== generation) {
      return;
    }
    const now = Date.now();
    if (now - lastReportedAt >= 10_000) {
      lastReportedAt = now;
      tilecast.reportProgress(item.id, "video-progress");
    }
    if (endS !== null && video.currentTime >= endS) {
      finish();
    }
  };
  video.onended = finish;
  video.onerror = () => {
    if (myGeneration === generation) {
      failItem(item, "video failed: " + (video.error?.message ?? "unknown"));
    }
  };
  // A fixed durationMs (rare for video) also bounds the item.
  if (item.durationMs) {
    itemTimer = window.setTimeout(finish, item.durationMs);
  }
  video.currentTime = startS;
  backLayer.replaceChildren(video);
  video.src = item.src;
  if (startS > 0) {
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.currentTime = startS;
      },
      { once: true },
    );
  }
}

function renderWebsite(item: RendererItem, myGeneration: number): void {
  const config = item.website;
  if (!config) {
    failItem(item, "website configuration missing");
    return;
  }

  const webview = document.createElement("webview");
  webview.setAttribute("partition", "persist:websites");
  webview.setAttribute("allowpopups", "false");
  webview.style.backgroundColor = config.backgroundColor || "#000";
  let loaded = false;
  let failed = false;

  const showFallback = (reason: string) => {
    if (failed || myGeneration !== generation || currentItem !== item) {
      return;
    }
    failed = true;
    tilecast.reportPlaybackError(item.id, "website failed: " + reason);
    if (config.failureBehavior === "skip" || !config.fallbackSrc) {
      // Advance without counting a hard failure spiral; websites fail for
      // reasons that never affect cached media.
      advance();
      return;
    }
    const fallbackImage = document.createElement("img");
    fallbackImage.style.objectFit = "contain";
    fallbackImage.src = config.fallbackSrc;
    fallbackImage.onload = () => {
      swapLayers();
      tilecast.reportProgress(item.id, "image-shown");
    };
    backLayer.replaceChildren(fallbackImage);
    itemTimer = window.setTimeout(() => advance(), item.durationMs ?? 60_000);
  };

  const loadTimeout = window.setTimeout(
    () => showFallback("load timeout"),
    Math.max(config.loadTimeoutSeconds, 5) * 1_000,
  );

  webview.addEventListener("did-finish-load", () => {
    if (myGeneration !== generation || currentItem !== item || failed) {
      return;
    }
    window.clearTimeout(loadTimeout);
    if (!loaded) {
      loaded = true;
      if (config.zoomPercent && config.zoomPercent !== 100) {
        try {
          (
            webview as unknown as { setZoomFactor(f: number): void }
          ).setZoomFactor(config.zoomPercent / 100);
        } catch {
          /* zoom is cosmetic */
        }
      }
      swapLayers();
      consecutiveFailures = 0;
    } else {
      tilecast.reportWebsiteRecovered();
    }
    tilecast.reportProgress(item.id, "website-loaded");
    // Healthy website: keep reporting while it stays on screen.
    if (stillImageTicker === null) {
      stillImageTicker = window.setInterval(() => {
        tilecast.reportProgress(item.id, "website-alive");
      }, 30_000);
    }
  });
  webview.addEventListener("did-fail-load", (event) => {
    const e = event as unknown as { errorCode: number; isMainFrame: boolean };
    if (e.isMainFrame && e.errorCode !== -3 /* aborted */) {
      window.clearTimeout(loadTimeout);
      showFallback("error " + e.errorCode);
    }
  });
  webview.addEventListener("crashed", () => {
    window.clearTimeout(loadTimeout);
    showFallback("renderer crashed");
  });

  if (config.refreshIntervalSeconds) {
    websiteRefreshTimer = window.setInterval(
      () => {
        try {
          (webview as unknown as { reload(): void }).reload();
        } catch {
          /* reload best-effort */
        }
      },
      Math.max(config.refreshIntervalSeconds, 30) * 1_000,
    );
  }

  itemTimer = window.setTimeout(() => advance(), item.durationMs ?? 60_000);
  backLayer.replaceChildren(webview);
  webview.setAttribute("src", item.src);
}

// ------------------------------------------------------------- app states

function showSetup(): void {
  showMessage(`
    <img class="brand-logo" src="tilecast-logo-white.svg" alt="Tilecast" />
    <p>Choose your Tilecast server, or enter its address.</p>
    <div id="discovered" style="display:flex;flex-direction:column;gap:10px;width:60%;"></div>
    <input id="setup-input" type="url" placeholder="https://signage.example.org" autofocus />
    <div id="setup-error"></div>
  `);
  const input = document.getElementById("setup-input") as HTMLInputElement;
  const error = document.getElementById("setup-error") as HTMLDivElement;
  const discovered = document.getElementById("discovered") as HTMLDivElement;
  const knownUrls = new Set<string>();

  const submit = (url: string) => {
    void tilecast.submitServerUrl(url).then((result) => {
      if (!result.ok) {
        error.textContent = result.error ?? "Invalid address";
      }
    });
  };

  const addServer = (server: { name: string; serverUrl: string }) => {
    if (knownUrls.has(server.serverUrl)) {
      return;
    }
    knownUrls.add(server.serverUrl);
    const button = document.createElement("button");
    button.textContent = `${server.name} — ${server.serverUrl}`;
    button.style.cssText =
      "font-size:24px;padding:14px 20px;border-radius:8px;border:1px solid #4C8BF5;background:#16202B;color:#fff;cursor:pointer;text-align:left;";
    button.addEventListener("click", () => submit(server.serverUrl));
    discovered.appendChild(button);
  };

  input.focus();
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      submit(input.value);
    }
  });

  tilecast.onDiscoveredServer(addServer);
  void tilecast
    .listDiscoveredServers()
    .then((servers) => servers.forEach(addServer));
}

function present(presentation: RendererPresentation): void {
  switch (presentation.state) {
    case "setup":
      showSetup();
      break;
    case "pairing":
      showMessage(`
        <img class="brand-logo" src="tilecast-logo-white.svg" alt="Tilecast" />
        <h1>${escapeHtml(presentation.organizationName ?? "Tilecast")}</h1>
        <p>Approve this screen in Tilecast Studio with the code below.</p>
        <div class="code">${escapeHtml(presentation.code ?? "")}</div>
        <p>${escapeHtml(presentation.approvalUrl ?? "")}</p>
      `);
      break;
    case "idle":
      showMessage(`
        <h1>${escapeHtml(presentation.title ?? "Waiting for content")}</h1>
        <p>${escapeHtml(presentation.message ?? "")}</p>
      `);
      break;
    case "disabled":
      showMessage(`
        <h1>${escapeHtml(presentation.title ?? "Screen disabled")}</h1>
        <p>${escapeHtml(presentation.message ?? "")}</p>
      `);
      break;
    case "safe-mode":
      showMessage(`
        <h1>Safe mode</h1>
        <p>${escapeHtml(presentation.reason ?? "")}</p>
        <p>The player remains connected and accepts commands from Tilecast Studio.</p>
      `);
      break;
    case "sleep":
      // Outside active hours: true black, all media torn down, no decoding.
      showMessage("");
      break;
    case "playing":
      startPlaying(presentation);
      break;
    default:
      break;
  }
}

// The bridge is injected by the preload via contextBridge. If it is missing,
// the preload failed to load (e.g. a sandboxed renderer cannot require its
// core modules). Surface that on screen instead of throwing at the first
// tilecast.* call, which would leave a headless kiosk silently black with no
// way to diagnose it in the field.
if (typeof tilecast === "undefined") {
  showMessage(`
    <h1>Display bridge unavailable</h1>
    <p>The player UI could not connect to the runtime. The device will
    keep trying; if this persists, check the player logs.</p>
  `);
  throw new Error("tilecast bridge missing: preload did not load");
}

tilecast.onPresent(present);

tilecast.onIdentify(({ name, durationSeconds }) => {
  identifyEl.textContent = name;
  identifyEl.classList.add("visible");
  window.setTimeout(
    () => identifyEl.classList.remove("visible"),
    durationSeconds * 1_000,
  );
});

tilecast.onRetryItem(() => {
  if (currentItem) {
    void renderItem(currentItem, generation);
  }
});

tilecast.onSkipItem(() => {
  advance();
});
