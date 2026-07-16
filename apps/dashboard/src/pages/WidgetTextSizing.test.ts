import { describe, expect, it } from "vitest";
import { widgetTextFactor } from "./LayoutEditorPage";

describe("Widget text sizing", () => {
  it("scales automatic text with the Widget bounds", () => {
    expect(widgetTextFactor({ width: 480, height: 270 }, {})).toBeCloseTo(0.25);
    expect(widgetTextFactor({ width: 1920, height: 1080 }, {})).toBe(1);
  });

  it("applies a custom scale to the responsive result", () => {
    expect(
      widgetTextFactor({ width: 960, height: 540 }, { textScale: 150 }),
    ).toBeCloseTo(0.75);
  });
});
