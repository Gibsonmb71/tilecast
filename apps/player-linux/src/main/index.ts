/**
 * Tilecast Player for Linux — Electron main process.
 *
 * The main process is a thin host: it owns the kiosk window, the tcmedia://
 * protocol, renderer crash recovery, and process relaunch. All protocol and
 * reliability logic lives in the core runtime. Under systemd (see
 * deploy/tilecast-player.service) a crashed or deliberately restarted
 * process comes straight back, completing the zero-touch loop.
 */

import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  net,
  powerSaveBlocker,
  protocol,
  screen,
  session,
} from "electron";
import type { NativeImage } from "electron";
import { promises as fs } from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { logger, setLogLevel } from "../core/log";
import {
  loadOutsideActiveHoursPresentation,
  type OutsideActiveHoursPresentation,
} from "../core/outside-hours";
import { PlayerRuntime, type Presentation } from "../core/player";
import { StateStore, defaultDataDir } from "../core/storage";
import { normalizeServerUrl } from "../core/server-url";
import { applyLowEndTuning } from "./hardware";
import { LanDiscovery, type DiscoveredServer } from "./discovery";

const log = logger("main");

const PLAYER_VERSION = app.getVersion() || "0.1.0";
const SERVER_URL_FILE = "server.json";
const OUTSIDE_HOURS_REFRESH_MS = 5_000;

type HostPresentation = Presentation | OutsideActiveHoursPresentation;

if (process.env.TILECAST_LOG_LEVEL === "debug") {
  setLogLevel("debug");
}

// Must run before app is ready: sizes GPU/V8 memory and enables Intel VA-API
// video decode for the low-end reference hardware.
applyLowEndTuning(app);

// A second instance must never fight the first over the display or state.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "tcmedia",
    privileges: { standard: true, stream: true, supportFetchAPI: true },
  },
]);

let window: BrowserWindow | null = null;
let runtime: PlayerRuntime | null = null;
let store: StateStore;
let discovery: LanDiscovery | null = null;
let lastPresentation: HostPresentation = { state: "setup" };
let quitting = false;

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function resolveServerUrl(): Promise<string | null> {
  const fromArg = argValue("--server-url");
  const fromEnv = process.env.TILECAST_SERVER_URL;
  const configured = fromArg ?? fromEnv ?? null;
  if (configured) {
    const result = normalizeServerUrl(configured);
    if (!result.ok || !result.url) {
      log.error("configured server url rejected by policy", {
        error: result.error,
      });
      return null;
    }
    await store.writeJson(SERVER_URL_FILE, { serverUrl: result.url });
    return result.url;
  }
  const persisted = await store.readJson<{ serverUrl: string }>(
    SERVER_URL_FILE,
  );
  return persisted?.serverUrl ?? null;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: process.env.TILECAST_WINDOWED !== "1",
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // The OS sandbox defaults to on (Electron >= 20). A sandboxed preload can
      // only require "electron" and a few polyfilled built-ins, but ours pulls
      // in local core modules (StateStore -> fs, synchronized-playback) to
      // enrich presentations before exposing the "tilecast" bridge. Under the
      // sandbox that require throws, exposeInMainWorld never runs, and the
      // renderer's top-level tilecast.onPresent() call dies — a permanent black
      // screen. Disabling only the OS sandbox (contextIsolation stays on,
      // nodeIntegration stays off) keeps the renderer itself isolated while
      // letting the trusted preload load its Node-backed modules.
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "..", "..", "static", "index.html"));

  win.webContents.on("render-process-gone", (_event, details) => {
    log.error("renderer process gone; recreating window", {
      reason: details.reason,
    });
    recreateWindow();
  });
  win.webContents.on("did-finish-load", () => {
    // (Re)send state after any load or reload so a recreated renderer
    // resumes exactly where the player left off.
    win.webContents.send("present", lastPresentation);
  });
  win.on("unresponsive", () => {
    log.error("window unresponsive; recreating");
    recreateWindow();
  });
  win.on("closed", () => {
    if (!quitting && window === win) {
      log.warn("window closed unexpectedly; recreating");
      window = null;
      recreateWindow();
    }
  });
  return win;
}

function recreateWindow(): void {
  if (quitting) {
    return;
  }
  const old = window;
  window = createWindow();
  if (old && !old.isDestroyed()) {
    old.removeAllListeners("closed");
    old.destroy();
  }
}

function sendPresentation(presentation: HostPresentation): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send("present", presentation);
  }
}

async function refreshOutsideActiveHoursPresentation(): Promise<void> {
  if (lastPresentation.state !== "sleep") {
    return;
  }

  try {
    const presentation = await loadOutsideActiveHoursPresentation(store);
    // Playback may have resumed while the configuration was being read.
    if (lastPresentation.state !== "sleep") {
      return;
    }
    if (JSON.stringify(presentation) === JSON.stringify(lastPresentation)) {
      return;
    }
    lastPresentation = presentation;
    sendPresentation(presentation);
  } catch (error) {
    log.warn("failed to refresh outside-hours presentation", {
      error: String(error),
    });
  }
}

function present(presentation: Presentation): void {
  lastPresentation = presentation;
  sendPresentation(presentation);
  if (presentation.state === "sleep") {
    void refreshOutsideActiveHoursPresentation();
  }
}

/**
 * Encode a captured frame to a downscaled JPEG within the given limits.
 * Preserves aspect ratio, never upscales, and steps quality down until the
 * result fits the byte budget. Returns null for an empty frame or one that
 * cannot be squeezed under the limit.
 */
function encodePreview(
  image: NativeImage,
  max: { width: number; height: number; bytes: number },
): { jpeg: Buffer; width: number; height: number } | null {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) {
    return null;
  }
  const ratio = Math.min(max.width / size.width, max.height / size.height, 1);
  const resized =
    ratio < 1
      ? image.resize({
          width: Math.round(size.width * ratio),
          height: Math.round(size.height * ratio),
          quality: "good",
        })
      : image;
  const finalSize = resized.getSize();
  let quality = 75;
  let jpeg = resized.toJPEG(quality);
  while (jpeg.byteLength > max.bytes && quality > 25) {
    quality -= 15;
    jpeg = resized.toJPEG(quality);
  }
  if (jpeg.byteLength > max.bytes) {
    return null;
  }
  return { jpeg, width: finalSize.width, height: finalSize.height };
}

/**
 * Whether to capture the live preview from the real display framebuffer
 * (desktopCapturer) rather than the window's own paint (capturePage).
 *
 * capturePage cannot read hardware-overlay video (enable-hardware-overlays),
 * VA-API-decoded frames, or <webview> content, so it returns an empty/black
 * frame for most signage content on Linux. desktopCapturer reads the actual
 * screen. On X11 this needs no permission and shows no prompt; on Wayland it
 * requires the screen-share portal, which can block on an input-less kiosk, so
 * default to off there. TILECAST_PREVIEW_SCREEN_CAPTURE=0/1 overrides.
 */
function screenCaptureAllowed(): boolean {
  const override = process.env.TILECAST_PREVIEW_SCREEN_CAPTURE;
  if (override !== undefined) {
    return override === "1" || override.toLowerCase() === "true";
  }
  return !process.env.WAYLAND_DISPLAY;
}

async function availableStorageBytes(): Promise<number | null> {
  try {
    const stats = await fs.statfs(store.dataDir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

function setupMediaProtocol(): void {
  protocol.handle("tcmedia", async (request) => {
    // tcmedia://variant/<assetId>/<variantId>
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const assetId = url.hostname === "variant" ? parts[0] : parts[1];
    const variantId = url.hostname === "variant" ? parts[1] : parts[2];
    if (!assetId || !variantId || !runtime) {
      return new Response("not found", { status: 404 });
    }
    const resolved = await runtime.resolveMedia(assetId, variantId);
    if (!resolved) {
      return new Response("not found", { status: 404 });
    }
    if (resolved.kind === "file") {
      // net.fetch on a file URL supports Range for video seeking.
      const headers = new Headers();
      const range = request.headers.get("Range");
      if (range) {
        headers.set("Range", range);
      }
      const response = await net.fetch(
        pathToFileURL(resolved.path).toString(),
        {
          headers,
        },
      );
      const out = new Headers(response.headers);
      out.set("Content-Type", resolved.mimeType);
      return new Response(response.body, {
        status: response.status,
        headers: out,
      });
    }
    // Stream-policy media proxies to the server with device auth attached.
    const headers = new Headers(resolved.headers);
    const range = request.headers.get("Range");
    if (range) {
      headers.set("Range", range);
    }
    return net.fetch(resolved.url, { headers });
  });
}

function guardWebContents(): void {
  app.on("web-contents-created", (_event, contents) => {
    // Website items render in <webview>; nothing may open new windows or
    // navigate the shell away from the player.
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (contents.getType() === "webview") {
      contents.on("will-navigate", (event, targetUrl) => {
        if (!/^https?:/.test(targetUrl)) {
          event.preventDefault();
        }
      });
    }
  });
}

async function startRuntime(serverUrl: string): Promise<void> {
  runtime = new PlayerRuntime(
    store,
    {
      present,
      identify: (name, durationSeconds) => {
        window?.webContents.send("identify", { name, durationSeconds });
      },
      recreateRenderer: () => {
        if (window && !window.isDestroyed()) {
          window.webContents.reloadIgnoringCache();
        } else {
          recreateWindow();
        }
      },
      recreateWindow,
      restartProcess: () => {
        log.info("relaunching player process");
        quitting = true;
        app.relaunch();
        app.exit(0);
      },
      exitForUpdate: () => {
        log.info("exiting after AppImage update for systemd restart");
        quitting = true;
        app.exit(0);
      },
      clearWebsiteData: async () => {
        await session
          .fromPartition("persist:websites")
          .clearStorageData()
          .catch(() => {});
      },
      retryCurrentItem: () => window?.webContents.send("retry-item"),
      skipCurrentItem: () => window?.webContents.send("skip-item"),
      screenSize: () => {
        // The server rejects any heartbeat whose screen size is < 1, which
        // silently freezes the screen's presence ("online" but never updating
        // "last contacted"). Some Linux setups report 0x0 from the primary
        // display (e.g. before the compositor publishes geometry), so fall
        // back through the display size and the window's own content size, and
        // never return a non-positive dimension.
        const candidates: Array<{ width: number; height: number }> = [];
        try {
          const display = screen.getPrimaryDisplay();
          candidates.push(display.bounds, display.size, display.workAreaSize);
        } catch {
          /* no display available yet */
        }
        if (window && !window.isDestroyed()) {
          const size = window.getContentSize();
          candidates.push({ width: size[0] ?? 0, height: size[1] ?? 0 });
        }
        for (const candidate of candidates) {
          if (candidate && candidate.width >= 1 && candidate.height >= 1) {
            return {
              width: Math.round(candidate.width),
              height: Math.round(candidate.height),
            };
          }
        }
        return { width: 1920, height: 1080 };
      },
      availableStorageBytes,
      capturePreview: async (max) => {
        if (!window || window.isDestroyed()) {
          return null;
        }
        // Primary path: capture the real display framebuffer. This is the only
        // method that includes hardware-overlay video, VA-API-decoded frames,
        // and <webview> content — everything webContents.capturePage() misses
        // on this GPU pipeline, which is why previews came back "unavailable".
        if (screenCaptureAllowed()) {
          try {
            const display = screen.getDisplayMatching(window.getBounds());
            // Ask for the thumbnail already scaled to the upload cap so the old
            // GPU/CPU never encodes a full-resolution frame. desktopCapturer
            // preserves aspect ratio within these bounds.
            const sources = await desktopCapturer.getSources({
              types: ["screen"],
              thumbnailSize: { width: max.width, height: max.height },
            });
            const source =
              sources.find(
                (s) => String(s.display_id) === String(display.id),
              ) ?? sources[0];
            if (source && !source.thumbnail.isEmpty()) {
              const encoded = encodePreview(source.thumbnail, max);
              if (encoded) {
                return encoded;
              }
            }
            log.debug("preview: screen capture yielded no usable frame", {
              sources: sources.length,
            });
          } catch (err) {
            log.warn("preview: screen capture failed; trying capturePage", {
              error: String(err),
            });
          }
        }
        // Fallback: the window's own paint. Works for pure-DOM (image) content
        // and when screen capture is unavailable (e.g. Wayland without the
        // screen-share portal). Overlay video / webview frames stay black here.
        try {
          const image = await window.webContents.capturePage();
          return encodePreview(image, max);
        } catch (err) {
          log.warn("preview: capturePage failed", { error: String(err) });
          return null;
        }
      },
    },
    { serverUrl, playerVersion: PLAYER_VERSION },
  );
  await runtime.start();
}

app.whenReady().then(async () => {
  store = new StateStore(process.env.TILECAST_DATA_DIR ?? defaultDataDir());
  await store.init();

  // Keep the off-hours overlay in sync even when a policy changes while the
  // runtime remains in the same deduplicated sleep state.
  setInterval(
    () => void refreshOutsideActiveHoursPresentation(),
    OUTSIDE_HOURS_REFRESH_MS,
  );

  // The display must never blank while content plays.
  powerSaveBlocker.start("prevent-display-sleep");

  setupMediaProtocol();
  guardWebContents();

  ipcMain.on(
    "progress",
    (_event, data: { itemId: string | null; kind: string }) => {
      runtime?.onPlaybackProgress(data.itemId, data.kind);
    },
  );
  ipcMain.on(
    "playback-error",
    (_event, data: { itemId: string | null; message: string }) => {
      runtime?.onPlaybackError(data.itemId, data.message);
    },
  );
  ipcMain.on("website-recovered", () => runtime?.onWebsiteRecovered());
  ipcMain.handle("setup-server-url", async (_event, url: string) => {
    const result = normalizeServerUrl(String(url));
    if (!result.ok || !result.url) {
      return { ok: false, error: result.error ?? "Invalid address" };
    }
    await store.writeJson(SERVER_URL_FILE, { serverUrl: result.url });
    discovery?.stop();
    // Restart cleanly into the configured state.
    quitting = true;
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });

  window = createWindow();

  const serverUrl = await resolveServerUrl();
  if (!serverUrl) {
    present({ state: "setup" });
    // Offer LAN-discovered servers as one-tap choices on the setup screen.
    discovery = new LanDiscovery((server: DiscoveredServer) => {
      window?.webContents.send("discovered-server", server);
    });
    discovery.start();
    ipcMain.handle("list-discovered-servers", () => discovery?.list() ?? []);
    return;
  }

  try {
    await startRuntime(serverUrl);
  } catch (err) {
    log.error("runtime failed to start; relaunching in 15s", {
      error: String(err),
    });
    setTimeout(() => {
      quitting = true;
      app.relaunch();
      app.exit(1);
    }, 15_000);
  }
});

app.on("window-all-closed", () => {
  // A signage player has no user-driven quit; recreate instead. The
  // per-window closed handler usually restores it first — only act when it
  // has not.
  if (!quitting && (!window || window.isDestroyed())) {
    recreateWindow();
  }
});

app.on("before-quit", () => {
  quitting = true;
  runtime?.stop();
});

process.on("uncaughtException", (err) => {
  log.error("uncaught exception; relaunching", { error: String(err.stack) });
  quitting = true;
  try {
    app.relaunch();
  } finally {
    app.exit(1);
  }
});
process.on("unhandledRejection", (reason) => {
  // Never let an unawaited promise take the player down silently.
  log.error("unhandled rejection", { error: String(reason) });
});
