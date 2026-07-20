import type { StateStore } from "./storage";
import type { PlayerConfig } from "./types";

const CONFIG_FILE = "player-config.json";

export type OutsideActiveHoursDisplay =
  | "bouncing_logo"
  | "custom_text"
  | "black";

export interface OutsideActiveHoursPresentation {
  state: "sleep";
  display: OutsideActiveHoursDisplay;
  text: string;
  textColor: string;
}

interface StoredConfig {
  current?: PlayerConfig;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Convert the effective player configuration into the presentation rendered
 * while the screen is outside active hours. Unknown or missing modes fail
 * safely to true black.
 */
export function buildOutsideActiveHoursPresentation(
  config: PlayerConfig | null | undefined,
): OutsideActiveHoursPresentation {
  const power = config?.power ?? {};
  const branding = config?.branding ?? {};
  const configuredDisplay = trimmed(power["outsideActiveHoursDisplay"]);
  const display: OutsideActiveHoursDisplay =
    configuredDisplay === "bouncing_logo" ||
    configuredDisplay === "custom_text"
      ? configuredDisplay
      : "black";

  const text =
    trimmed(power["outsideActiveHoursText"]) ||
    trimmed(branding["footerText"]) ||
    "Powered by Tilecast";

  return {
    state: "sleep",
    display,
    text,
    textColor: trimmed(branding["textColor"]) || "#F5F7FA",
  };
}

/** Read the same atomic cached configuration used by ConfigSync at startup. */
export async function loadOutsideActiveHoursPresentation(
  store: StateStore,
): Promise<OutsideActiveHoursPresentation> {
  const stored = await store.readJson<StoredConfig>(CONFIG_FILE);
  return buildOutsideActiveHoursPresentation(stored?.current);
}
