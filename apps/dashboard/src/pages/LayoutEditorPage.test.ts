import { describe, expect, it } from "vitest";
import { createPrimitivePlacement } from "./LayoutEditorPage";

const canvas = {
  width: 1920,
  height: 1080,
  orientation: "landscape" as const,
  backgroundColor: "#101820",
  safeAreaPercent: 5,
};

describe("Layout editor primitives", () => {
  it("creates renderer-neutral text placements with safe bundled defaults", () => {
    const placement = createPrimitivePlacement("text", canvas);
    expect(placement.type).toBe("primitive");
    expect(placement.primitive?.kind).toBe("text");
    expect(placement.primitive?.fontFamily).toBe("Inter");
    expect(placement.widgetId).toBeUndefined();
    expect(placement.x + placement.width).toBeLessThanOrEqual(canvas.width);
  });

  it("creates line and group geometry inside the canvas", () => {
    const line = createPrimitivePlacement("line", canvas);
    const group = createPrimitivePlacement("group", canvas);
    expect(line.height).toBe(8);
    expect(group.primitive?.kind).toBe("group");
    expect(group.y + group.height).toBeLessThanOrEqual(canvas.height);
  });
});
