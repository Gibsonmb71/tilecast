import type { PlayerConfig } from "./types";

export interface LinuxKioskPolicy {
  fullscreenEnabled: boolean;
  preventDisplaySleep: boolean;
}

export function linuxKioskPolicy(
  config: PlayerConfig | null,
): LinuxKioskPolicy {
  return {
    fullscreenEnabled: config?.linuxKiosk?.["fullscreenEnabled"] !== false,
    preventDisplaySleep: config?.linuxKiosk?.["preventDisplaySleep"] !== false,
  };
}
