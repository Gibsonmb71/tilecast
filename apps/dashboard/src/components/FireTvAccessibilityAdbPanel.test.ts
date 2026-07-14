import { describe, expect, it } from "vitest";
import { fireTvAccessibilityCommands } from "./FireTvAccessibilityAdbPanel";

describe("Fire TV accessibility ADB commands", () => {
  it("uses the screen address and preserves existing services", () => {
    const commands = fireTvAccessibilityCommands("192.168.1.44");
    expect(commands.connect).toBe("adb connect 192.168.1.44:5555");
    expect(commands.enable).toContain("enabled_accessibility_services");
    expect(commands.enable).toContain("current="\${current:+$current:}$component"");
  });

  it("falls back to a clear placeholder when no address was reported", () => {
    expect(fireTvAccessibilityCommands().connect).toBe(
      "adb connect FIRE_TV_IP:5555",
    );
  });
});
