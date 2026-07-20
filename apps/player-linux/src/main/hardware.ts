/**
 * Low-end hardware tuning.
 *
 * The reference target is a ~2012 mini PC: dual-core Ivy Bridge, Intel HD
 * 4000 graphics, 4 GiB RAM, spinning or small SSD. The goal is smooth 1080p
 * signage with a tiny, stable memory footprint that never grows until the
 * OOM killer takes the player down at 3 a.m.
 *
 * These switches MUST be applied before app.whenReady(). They are
 * deliberately conservative and overridable by env vars so a beefier box or a
 * troublesome GPU can be tuned in the field without a rebuild.
 */

import type { App } from "electron";

function envFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}

export function applyLowEndTuning(app: App): void {
  // --- Memory --------------------------------------------------------------
  // Cap the V8 old-space so a slow leak surfaces as a recoverable renderer
  // restart (self-heal) instead of an OS-level OOM kill of the whole box.
  // 512 MiB in the main process is plenty for a headless orchestrator.
  app.commandLine.appendSwitch("js-flags", "--max-old-space-size=384");
  // Tile/raster memory is the biggest GPU-process consumer on Intel; keep it
  // modest for a single fullscreen surface.
  app.commandLine.appendSwitch("force-gpu-mem-available-mb", "256");

  // --- GPU / video decode --------------------------------------------------
  // Intel HD 4000 (Gen7) does hardware H.264 (and often VP9) decode through
  // VA-API. Enabling it keeps 1080p video off the CPU, which a dual-core
  // Ivy Bridge cannot sustain in software. If a specific box has a broken
  // VA-API stack, set TILECAST_DISABLE_VAAPI=1 to fall back to software.
  if (envFlag("TILECAST_HW_DECODE", true)) {
    app.commandLine.appendSwitch(
      "enable-features",
      "VaapiVideoDecoder,VaapiIgnoreDriverChecks,CanvasOopRasterization",
    );
    app.commandLine.appendSwitch("disable-features", "UseChromeOSDirectVideoDecoder");
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
  } else {
    app.commandLine.appendSwitch("disable-features", "VaapiVideoDecoder");
  }

  if (envFlag("TILECAST_DISABLE_GPU", false)) {
    // Escape hatch for a box whose GPU driver crashes the compositor: run
    // fully software. Slower, but never a black screen.
    app.disableHardwareAcceleration();
  }

  // --- Compositor / animation ----------------------------------------------
  // Signage is mostly static; a very high frame rate wastes an old CPU.
  // Cap the frame rate so idle content (a still image, a slow ticker) does
  // not keep the cores warm.
  app.commandLine.appendSwitch(
    "max-gum-fps",
    process.env.TILECAST_MAX_FPS ?? "30",
  );
  // Smooth crossfades without the extra memory of persistent backing stores
  // for hidden surfaces.
  app.commandLine.appendSwitch("enable-hardware-overlays", "single-fullscreen");

  // --- Background throttling -----------------------------------------------
  // The player window is always foreground; disabling renderer backgrounding
  // avoids Chromium pausing timers if the window ever loses focus briefly.
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}
