import { describe, expect, it } from "vitest";
import {
  parseDisplayControlCommand,
  unsupportedDisplayControlStatus,
} from "./display-control";
import type { PlayerCommand } from "./types";

function command(
  type: string,
  payload: Record<string, unknown> = {},
): PlayerCommand {
  return {
    id: "command",
    type,
    payload,
    idempotencyKey: "key",
    state: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

describe("display control command parsing", () => {
  it("accepts bounded typed values", () => {
    expect(
      parseDisplayControlCommand(
        command("display_set_brightness", { brightness: 75 }),
      ),
    ).toEqual({
      type: "display_set_brightness",
      brightness: 75,
    });
  });

  it("rejects unsafe or incomplete payloads", () => {
    expect(
      parseDisplayControlCommand(
        command("display_set_input", { input: "1; reboot" }),
      ),
    ).toBeNull();
    expect(
      parseDisplayControlCommand(command("display_power_on", { volume: 50 })),
    ).toBeNull();
    expect(
      parseDisplayControlCommand(
        command("display_set_input", { input: "1.0.0.0", volume: 50 }),
      ),
    ).toBeNull();
    expect(
      parseDisplayControlCommand(command("display_set_volume")),
    ).toBeNull();
  });

  it("has a graceful unsupported status", () => {
    expect(unsupportedDisplayControlStatus().powerState).toBe("unsupported");
  });
});
