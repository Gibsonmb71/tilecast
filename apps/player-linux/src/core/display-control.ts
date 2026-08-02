import type { CommandResultReport, PlayerCommand } from "./types";

export const DISPLAY_CONTROL_COMMANDS = new Set([
  "display_power_on",
  "display_power_off",
  "display_set_input",
  "display_set_volume",
  "display_mute",
  "display_unmute",
  "display_set_brightness",
  "display_probe",
]);

export type DisplayPowerState =
  "unknown" | "on" | "off" | "transitioning" | "unsupported";

export interface DisplayControlStatus {
  provider?: string;
  providers: string[];
  capabilities: Record<string, string>;
  powerState: DisplayPowerState;
  powerStateConfirmed: boolean;
  observedAt?: string;
  policyState?: "normal" | "powered_off_by_policy" | "unknown";
  error?: string;
}

export interface DisplayControlCommand {
  type: string;
  input?: string;
  volume?: number;
  brightness?: number;
}

export interface DisplayControlResult extends CommandResultReport {
  status?: DisplayControlStatus;
}

export interface DisplayControlHost {
  probeDisplayControl?(): Promise<DisplayControlStatus>;
  executeDisplayControl?(
    command: DisplayControlCommand,
  ): Promise<DisplayControlResult>;
}

/** Validate both remote commands and manifest-sourced policy actions before
 * any provider receives an argument. The manifest is authenticated, but this
 * boundary still keeps a malformed database value out of cec-ctl/ddcutil. */
export function validateDisplayControlCommand(
  command: DisplayControlCommand,
): DisplayControlCommand | null {
  if (!DISPLAY_CONTROL_COMMANDS.has(command.type)) return null;
  const { input, volume, brightness } = command;
  if (input !== undefined && typeof input !== "string") return null;
  if (
    (volume !== undefined &&
      (typeof volume !== "number" || !Number.isInteger(volume))) ||
    (brightness !== undefined &&
      (typeof brightness !== "number" || !Number.isInteger(brightness)))
  ) {
    return null;
  }
  if (input !== undefined && !/^[A-Za-z0-9._:-]{1,32}$/.test(input)) {
    return null;
  }
  if (
    (volume !== undefined && (volume < 0 || volume > 100)) ||
    (brightness !== undefined && (brightness < 0 || brightness > 100))
  ) {
    return null;
  }
  const hasPayload =
    input !== undefined || volume !== undefined || brightness !== undefined;
  switch (command.type) {
    case "display_power_on":
    case "display_power_off":
    case "display_mute":
    case "display_unmute":
    case "display_probe":
      if (hasPayload) return null;
      break;
    case "display_set_input":
      if (
        input === undefined ||
        volume !== undefined ||
        brightness !== undefined
      )
        return null;
      break;
    case "display_set_volume":
      if (
        volume === undefined ||
        input !== undefined ||
        brightness !== undefined
      )
        return null;
      break;
    case "display_set_brightness":
      if (
        brightness === undefined ||
        input !== undefined ||
        volume !== undefined
      )
        return null;
      break;
  }
  return { type: command.type, input, volume, brightness };
}

export function parseDisplayControlCommand(
  command: PlayerCommand,
): DisplayControlCommand | null {
  if (!DISPLAY_CONTROL_COMMANDS.has(command.type)) return null;
  const payload = command.payload ?? {};
  const keys = Object.keys(payload);
  if (keys.some((key) => !["input", "volume", "brightness"].includes(key))) {
    return null;
  }
  const input = payload.input;
  const volume = payload.volume;
  const brightness = payload.brightness;
  if (input !== undefined && typeof input !== "string") return null;
  if (
    (volume !== undefined &&
      (typeof volume !== "number" || !Number.isInteger(volume))) ||
    (brightness !== undefined &&
      (typeof brightness !== "number" || !Number.isInteger(brightness)))
  ) {
    return null;
  }
  return validateDisplayControlCommand({
    type: command.type,
    input: input as string | undefined,
    volume: volume as number | undefined,
    brightness: brightness as number | undefined,
  });
}

export function unsupportedDisplayControlStatus(
  error = "This player does not provide Display Control.",
): DisplayControlStatus {
  return {
    provider: "unsupported",
    providers: ["unsupported"],
    capabilities: {},
    powerState: "unsupported",
    powerStateConfirmed: false,
    policyState: "unknown",
    error,
  };
}
