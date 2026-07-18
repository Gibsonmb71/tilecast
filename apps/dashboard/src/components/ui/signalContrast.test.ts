import { describe, expect, it } from "vitest";

function luminance(hex: string) {
  const channels = hex
    .match(/.{2}/g)
    ?.map((value) => parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error("Invalid test color");
  const [red = 0, green = 0, blue = 0] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("Tilecast Signal contrast", () => {
  it.each([
    ["FFFFFF", "3E6FE0", "primary button"],
    ["17212B", "F6F8FA", "light canvas text"],
    ["1A2333", "FFFFFF", "light field value"],
    ["3D4C66", "FFFFFF", "light secondary button"],
    ["C23B46", "FFFFFF", "light notification badge"],
    ["F5F7FA", "151D26", "dark surface text"],
    ["0E141B", "F4C15A", "amber identity mark"],
  ])("meets AA for %s on %s (%s)", (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
