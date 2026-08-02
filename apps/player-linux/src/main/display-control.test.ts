import { describe, expect, it, vi } from "vitest";
import { LinuxDisplayControl, type RunDisplayCommand } from "./display-control";

describe("LinuxDisplayControl", () => {
  it("combines independent CEC and DDC capabilities", async () => {
    const run: RunDisplayCommand = vi.fn(async (binary) =>
      binary === "cec-ctl"
        ? { code: 0, stdout: "CEC adapter", stderr: "" }
        : { code: 0, stdout: "Display 1: DDC", stderr: "" },
    );
    const control = new LinuxDisplayControl(run, async () => true);
    const status = await control.probe();
    expect(status.capabilities).toMatchObject({
      power: "hdmi_cec",
      brightness: "ddc_ci",
    });
    expect(status.providers).toEqual(["hdmi_cec", "ddc_ci"]);
  });

  it("uses fixed argument vectors and reports sent versus confirmed", async () => {
    const calls: string[][] = [];
    const run: RunDisplayCommand = vi.fn(async (binary, args) => {
      calls.push([binary, ...args]);
      return binary === "cec-ctl"
        ? { code: 0, stdout: "CEC adapter", stderr: "" }
        : { code: 0, stdout: "Display 1: DDC", stderr: "" };
    });
    const control = new LinuxDisplayControl(run, async () => true);
    await control.probe();
    const result = await control.execute({ type: "display_power_off" });
    expect(result.code).toBe("display_command_sent");
    expect(result.status?.powerStateConfirmed).toBe(false);
    expect(calls.some((call) => call.includes("--standby"))).toBe(true);
    expect(calls.flat().join(" ")).not.toContain(";");
  });

  it("fails gracefully when no provider is present", async () => {
    const run: RunDisplayCommand = vi.fn(async () => ({
      code: 1,
      stdout: "",
      stderr: "missing",
    }));
    const control = new LinuxDisplayControl(run, async () => false);
    const result = await control.execute({ type: "display_power_on" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("display_unsupported");
  });

  it("keeps provider execution bounded", async () => {
    const timeouts: number[] = [];
    const run: RunDisplayCommand = vi.fn(async (binary, _args, timeoutMs) => {
      timeouts.push(timeoutMs);
      return binary === "cec-ctl"
        ? { code: 0, stdout: "CEC adapter", stderr: "" }
        : { code: 0, stdout: "Display 1: DDC", stderr: "" };
    });
    const control = new LinuxDisplayControl(run, async () => true);
    await control.execute({ type: "display_power_on" });
    expect(timeouts.length).toBeGreaterThan(0);
    expect(timeouts.every((timeoutMs) => timeoutMs === 5_000)).toBe(true);
  });
});
