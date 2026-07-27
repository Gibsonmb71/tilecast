import { describe, expect, it } from "vitest";
import {
  contentExpectationFor,
  layoutZoneExpectations,
  type PresentationItem,
} from "./player";

function layout(
  zones: {
    id: string;
    playlistItems?: { id: string }[];
    render?: unknown;
    image?: unknown;
  }[],
): PresentationItem {
  return {
    id: "layout-1",
    kind: "layout",
    src: "",
    durationMs: null,
    fitMode: "contain",
    audioEnabled: false,
    volume: 0,
    videoStartOffsetMs: null,
    videoEndOffsetMs: null,
    layout: { zones } as PresentationItem["layout"],
  } as PresentationItem;
}

describe("layout zone expectations", () => {
  it("expects a first render from every zone", () => {
    const zones = layoutZoneExpectations(
      layout([
        { id: "left", render: {} },
        { id: "right", image: {} },
        { id: "bottom", playlistItems: [{ id: "a" }, { id: "b" }] },
      ]),
    );
    expect(zones.zoneIds).toEqual(["left", "right", "bottom"]);
  });

  it("only holds a rotating zone to continuing evidence", () => {
    const zones = layoutZoneExpectations(
      layout([
        { id: "widget", render: {} },
        { id: "poster", image: {} },
        { id: "carousel", playlistItems: [{ id: "a" }, { id: "b" }] },
      ]),
    );
    // A widget or image zone renders once and holds, exactly like a still
    // image; demanding a cadence from it would flag a healthy layout.
    expect(zones.recurringZoneIds).toEqual(["carousel"]);
  });

  it("does not treat a single-item zone as rotating", () => {
    const zones = layoutZoneExpectations(
      layout([{ id: "solo", playlistItems: [{ id: "only" }] }]),
    );
    // One item loops in place rather than advancing, so it produces no
    // further evidence and must not be expected to.
    expect(zones.recurringZoneIds).toEqual([]);
    expect(zones.zoneIds).toEqual(["solo"]);
  });

  it("ignores a zone with no identity", () => {
    const zones = layoutZoneExpectations(layout([{ id: "", render: {} }]));
    // An unidentifiable zone can never report, so demanding evidence from it
    // would leave the layout permanently stalled.
    expect(zones.zoneIds).toEqual([]);
  });

  it("expects nothing from a non-layout item", () => {
    expect(layoutZoneExpectations(undefined)).toEqual({
      zoneIds: [],
      recurringZoneIds: [],
    });
  });
});

describe("content expectations", () => {
  it("maps each renderer item kind to how its progress is judged", () => {
    expect(contentExpectationFor("video")).toBe("video");
    expect(contentExpectationFor("image")).toBe("still");
    expect(contentExpectationFor("website")).toBe("website");
    expect(contentExpectationFor("youtube")).toBe("website");
    expect(contentExpectationFor("widget")).toBe("website");
    // Layouts are judged per zone now that the renderer reports per zone.
    expect(contentExpectationFor("layout")).toBe("layout");
  });

  it("falls back to renderer health for an unknown kind", () => {
    expect(contentExpectationFor("something-new")).toBe("indefinite");
  });
});
