import { describe, expect, it } from "vitest";
import { layoutFontStack } from "./layoutFonts";

describe("layoutFontStack", () => {
  it("keeps every supported family on a sans-serif fallback stack", () => {
    expect(layoutFontStack("Source Sans 3")).toBe(
      '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
    );
    expect(layoutFontStack("Noto Sans")).toContain("sans-serif");
  });

  it("uses Inter instead of the browser serif default for unknown values", () => {
    expect(layoutFontStack("missing")).toBe(
      '"Inter", ui-sans-serif, system-ui, sans-serif',
    );
  });
});
