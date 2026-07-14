import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("./OperationsDashboard.css", import.meta.url)),
  "utf8",
);

describe("Overview dashboard polish", () => {
  it("stacks the main dashboard regions to avoid the tall empty grid row", () => {
    expect(css).toContain("/* Overview density and light-theme polish */");
    expect(css).toMatch(/\.ops-layout\s*{[^}]*grid-template-columns:\s*1fr;/s);
    expect(css).toMatch(
      /\.ops-layout__supporting\s*{[^}]*grid-template-columns:\s*repeat\(2,/s,
    );
  });

  it("uses theme-aware surfaces and text for operational states", () => {
    expect(css).toContain("color-mix(in srgb, var(--tc-bg-surface)");
    expect(css).toContain("color: var(--tc-text-secondary)");
    expect(css).toContain("background: var(--tc-bg-subtle)");
  });
});
