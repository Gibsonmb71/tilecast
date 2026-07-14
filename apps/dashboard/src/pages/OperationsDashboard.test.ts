import { describe, expect, it } from "vitest";
import styles from "./OperationsDashboard.css?raw";

describe("Operations Dashboard styling", () => {
  it("uses independent dashboard columns to avoid empty grid space", () => {
    expect(styles).toContain(".ops-dashboard-grid");
    expect(styles).toContain(".ops-dashboard-grid__main");
    expect(styles).toContain(".ops-dashboard-grid__rail");
  });

  it("derives operational colors from the active theme", () => {
    expect(styles).toContain("color-mix(in srgb, var(--tc-bg-surface)");
    expect(styles).toContain("color: var(--tc-text-secondary)");
    expect(styles).toContain("background: var(--tc-bg-subtle)");
  });
});
