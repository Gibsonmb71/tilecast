import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import type {
  DisplayControlCommand,
  DisplayControlResult,
  DisplayControlStatus,
} from "../core/display-control";
import { validateDisplayControlCommand } from "../core/display-control";

const COMMAND_TIMEOUT_MS = 5_000;
const CEC_DEVICE = "/dev/cec0";
const DDC_DISPLAY = "1";

type CommandOutput = { code: number; stdout: string; stderr: string };
export type RunDisplayCommand = (
  binary: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandOutput>;

function runDisplayCommand(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandOutput> {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      {
        shell: false,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        const childError = error as (Error & { code?: number }) | null;
        resolve({
          code:
            childError?.code && typeof childError.code === "number"
              ? childError.code
              : error
                ? 1
                : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function safeMessage(output: CommandOutput): string {
  const value = (
    output.stderr ||
    output.stdout ||
    "Display provider command failed"
  )
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value.slice(0, 240);
}

function baseStatus(): DisplayControlStatus {
  return {
    providers: [],
    capabilities: {},
    powerState: "unknown",
    powerStateConfirmed: false,
    policyState: "normal",
  };
}

export class LinuxDisplayControl {
  private status: DisplayControlStatus = baseStatus();

  constructor(
    private readonly run: RunDisplayCommand = runDisplayCommand,
    private readonly deviceExists: (path: string) => Promise<boolean> = async (
      path,
    ) =>
      fs
        .access(path)
        .then(() => true)
        .catch(() => false),
  ) {}

  async probe(): Promise<DisplayControlStatus> {
    const next = baseStatus();
    const [cecDevice, cec, ddc] = await Promise.all([
      this.deviceExists(CEC_DEVICE),
      this.run(
        "cec-ctl",
        ["-d", CEC_DEVICE, "--info"],
        COMMAND_TIMEOUT_MS,
      ).catch(() => ({ code: 1, stdout: "", stderr: "" })),
      this.run("ddcutil", ["detect", "--brief"], COMMAND_TIMEOUT_MS).catch(
        () => ({ code: 1, stdout: "", stderr: "" }),
      ),
    ]);
    const hasCEC = cecDevice && cec.code === 0;
    const hasDDC =
      ddc.code === 0 &&
      /display|monitor|i2c/i.test(`${ddc.stdout} ${ddc.stderr}`);
    if (hasCEC) {
      next.providers.push("hdmi_cec");
      next.capabilities.power = "hdmi_cec";
      next.capabilities.input = "hdmi_cec";
      next.capabilities.probe = "hdmi_cec";
    }
    if (hasDDC) {
      next.providers.push("ddc_ci");
      next.capabilities.brightness = "ddc_ci";
      next.capabilities.volume = "ddc_ci";
      next.capabilities.probe = next.capabilities.probe ?? "ddc_ci";
    }
    if (next.providers.length === 0) {
      next.provider = "unsupported";
      next.powerState = "unsupported";
      next.policyState = "unknown";
      next.error = "No supported HDMI-CEC or DDC/CI provider was detected.";
    } else {
      next.provider = next.providers[0];
    }
    this.status = next;
    return this.status;
  }

  async execute(command: DisplayControlCommand): Promise<DisplayControlResult> {
    const validated = validateDisplayControlCommand(command);
    if (!validated) {
      return {
        success: false,
        code: "display_invalid_payload",
        message: "Display command payload is invalid.",
        status: this.status,
      };
    }
    command = validated;
    if (command.type === "display_probe") {
      return {
        success: true,
        code: "display_probe_completed",
        message: "Display capabilities were probed.",
        status: await this.probe(),
      };
    }
    if (Object.keys(this.status.capabilities).length === 0) {
      await this.probe();
    }
    const provider = this.providerFor(command);
    if (!provider) {
      return {
        success: false,
        code: "display_unsupported",
        message: "This display does not report the requested capability.",
        status: this.status,
      };
    }
    const request = this.providerRequest(provider, command);
    if (!request) {
      return {
        success: false,
        code: "display_unsupported",
        message: "This provider cannot perform the requested display action.",
        status: this.status,
      };
    }
    const output = await this.run(
      request.binary,
      request.args,
      COMMAND_TIMEOUT_MS,
    ).catch(() => ({ code: 1, stdout: "", stderr: "" }));
    if (output.code !== 0) {
      this.status = {
        ...this.status,
        error: safeMessage(output),
        powerStateConfirmed: false,
      };
      return {
        success: false,
        code: "display_command_failed",
        message: this.status.error ?? "Display provider command failed.",
        status: this.status,
      };
    }
    if (
      command.type === "display_power_on" ||
      command.type === "display_power_off"
    ) {
      this.status = {
        ...this.status,
        powerState: "transitioning",
        powerStateConfirmed: false,
        observedAt: new Date().toISOString(),
        error: undefined,
      };
    } else {
      this.status = { ...this.status, error: undefined };
    }
    return {
      success: true,
      code: "display_command_sent",
      message: "Display command was sent; panel state is not yet confirmed.",
      status: this.status,
    };
  }

  private providerFor(command: DisplayControlCommand): string | null {
    switch (command.type) {
      case "display_power_on":
      case "display_power_off":
      case "display_set_input":
        return (
          this.status.capabilities[
            command.type === "display_set_input" ? "input" : "power"
          ] ?? null
        );
      case "display_set_volume":
        return this.status.capabilities.volume ?? null;
      case "display_mute":
      case "display_unmute":
        return this.status.capabilities.mute ?? null;
      case "display_set_brightness":
        return this.status.capabilities.brightness ?? null;
      default:
        return null;
    }
  }

  private providerRequest(
    provider: string,
    command: DisplayControlCommand,
  ): { binary: string; args: string[] } | null {
    if (provider === "hdmi_cec") {
      if (command.type === "display_power_on") {
        return {
          binary: "cec-ctl",
          args: ["-d", CEC_DEVICE, "--to", "0", "--image-view-on"],
        };
      }
      if (command.type === "display_power_off") {
        return {
          binary: "cec-ctl",
          args: ["-d", CEC_DEVICE, "--to", "0", "--standby"],
        };
      }
      if (command.type === "display_set_input" && command.input) {
        return {
          binary: "cec-ctl",
          args: [
            "-d",
            CEC_DEVICE,
            "--to",
            "0",
            "--active-source",
            "--phys-addr",
            command.input,
          ],
        };
      }
      return null;
    }
    if (provider === "ddc_ci") {
      const code =
        command.type === "display_set_brightness"
          ? "10"
          : command.type === "display_set_volume"
            ? "62"
            : null;
      const value =
        command.type === "display_set_brightness"
          ? command.brightness
          : command.volume;
      if (!code || value === undefined) return null;
      return {
        binary: "ddcutil",
        args: ["--display", DDC_DISPLAY, "setvcp", code, String(value)],
      };
    }
    return null;
  }
}
