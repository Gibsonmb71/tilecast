import { describe, expect, it } from "vitest";
import { renderWidget } from "./widget-render";
import { renderPresentation } from "./presentation-render";
import { renderLayout } from "./layout-render";
import { normalizeSource } from "./datasource";
import type {
  ManifestDataSource,
  ManifestWidget,
  LayoutDocument,
  PresentationNode,
} from "./content-types";
import type { Manifest } from "./types";

const at = new Date("2026-07-15T12:00:00-04:00");

function typedSource(id: string): ManifestDataSource {
  return {
    id,
    name: id,
    provider: "json",
    configVersion: 12,
    configuration: {
      fields: [
        { key: "title", label: "Title", type: "text" },
        { key: "price", label: "Price", type: "currency" },
      ],
      records: [
        { id: "1", values: { title: "Coffee", price: "3.5" } },
        { id: "2", values: { title: "Tea", price: "2.75" } },
      ],
    } as unknown as Record<string, unknown>,
  };
}

describe("normalizeSource", () => {
  it("flattens typed records into display strings", () => {
    const norm = normalizeSource(typedSource("s1"), at);
    expect(norm.records).toHaveLength(2);
    expect(norm.records[0]!.fields["title"]).toBe("Coffee");
    expect(norm.fieldTypes["price"]).toBe("currency");
  });
});

describe("renderWidget", () => {
  const ctx = (sources: ManifestDataSource[]) => ({
    dataSources: new Map(sources.map((s) => [s.id, s])),
    at,
  });

  it("renders a clock as a self-updating node", () => {
    const widget: ManifestWidget = {
      assetId: "w1",
      name: "Clock",
      provider: "clock",
      configVersion: 11,
      configuration: {
        timezone: "America/New_York",
        format: "24",
        showSeconds: true,
      },
    };
    const payload = renderWidget(widget, ctx([]))!;
    // Root box wraps the clock node.
    const stack = JSON.stringify(payload.root);
    expect(stack).toContain('"t":"clock"');
    expect(stack).toContain('"hour12":false');
  });

  it("renders a recurring countdown in the selected horizontal layout", () => {
    const widget: ManifestWidget = {
      assetId: "countdown-horizontal",
      name: "Countdown",
      provider: "countdown",
      configVersion: 13,
      configuration: {
        target: "2026-07-22T09:00:00",
        timezone: "America/New_York",
        recurrence: "daily",
        layout: "horizontal",
        label: "Doors open",
      },
    };
    const payload = renderWidget(widget, ctx([]))!;
    // The root is the full-bleed surface; the inset box inside it holds the
    // content area (the center 80 percent by default) and the layout direction.
    expect(payload.root).toMatchObject({
      t: "box",
      style: { width: 100, height: 100 },
      children: [
        { t: "box", style: { width: 80, height: 80, direction: "row" } },
      ],
    });
    expect(JSON.stringify(payload.root)).toContain('"recurrence":"daily"');
    expect(JSON.stringify(payload.root)).toContain("Doors open");
  });

  it("omits the title from a countdown-only layout", () => {
    const widget: ManifestWidget = {
      assetId: "countdown-only",
      name: "Countdown",
      provider: "countdown",
      configVersion: 13,
      configuration: {
        target: "2026-07-22T09:00:00Z",
        recurrence: "none",
        layout: "countdown_only",
        label: "Hidden title",
      },
    };
    const payload = renderWidget(widget, ctx([]))!;
    expect(JSON.stringify(payload.root)).not.toContain("Hidden title");
  });

  it("reads the countdown's textScale and contentPadding as percentages", () => {
    const countdown = (configuration: Record<string, unknown>) => {
      const payload = renderWidget(
        {
          assetId: "countdown-sizing",
          name: "Countdown",
          provider: "countdown",
          configVersion: 13,
          configuration: {
            target: "2026-07-22T09:00:00Z",
            layout: "countdown_only",
            ...configuration,
          },
        },
        ctx([]),
      )!;
      const content = (payload.root as { children: unknown[] }).children[0] as {
        style: { width: number };
        children: { style: { fontSize: number } }[];
      };
      return {
        inset: content.style.width,
        fontSize: content.children[0]!.style.fontSize,
      };
    };

    // Default: the center 80 percent of the Widget at the designed 88px type.
    expect(countdown({})).toEqual({ inset: 80, fontSize: 88 });
    // A scale is a percentage, so 50 halves the type rather than multiplying it.
    expect(countdown({ textScale: 50, contentPadding: 0 })).toEqual({
      inset: 100,
      fontSize: 44,
    });
    expect(countdown({ textScale: 500, contentPadding: 40 })).toEqual({
      inset: 20,
      fontSize: 440,
    });
  });

  it("renders a metric from a typed source with currency formatting", () => {
    const widget: ManifestWidget = {
      assetId: "w2",
      name: "Price",
      provider: "metric",
      configVersion: 12,
      configuration: {
        dataSourceId: "s1",
        valueField: "price",
        format: "currency",
        precision: 2,
      },
    };
    const payload = renderWidget(widget, ctx([typedSource("s1")]))!;
    expect(JSON.stringify(payload.root)).toContain("$3.50");
  });

  it("renders a menu/list from records", () => {
    const widget: ManifestWidget = {
      assetId: "w3",
      name: "Menu",
      provider: "list",
      configVersion: 12,
      configuration: { dataSourceId: "s1", primaryField: "title" },
    };
    const payload = renderWidget(widget, ctx([typedSource("s1")]))!;
    const json = JSON.stringify(payload.root);
    expect(json).toContain("Coffee");
    expect(json).toContain("Tea");
  });

  it("returns null for an unknown provider", () => {
    const widget: ManifestWidget = {
      assetId: "w4",
      name: "?",
      provider: "mystery",
      configVersion: 11,
      configuration: {},
    };
    expect(renderWidget(widget, ctx([]))).toBeNull();
  });
});

describe("renderPresentation (v13 declarative)", () => {
  it("projects a v2 countdown binding as a self-updating countdown node", () => {
    const tree = renderPresentation(
      {
        type: "text",
        binding: {
          source: "environment",
          path: "currentTime",
          format:
            "countdown:v2:2026-12-01T09%3A00:America%2FNew_York:countdown:weekly:completed_text:1110:Started",
        },
      },
      { datasets: new Map(), at },
    );
    expect(tree).toMatchObject({
      t: "countdown",
      target: "2026-12-01T09:00",
      timezone: "America/New_York",
      recurrence: "weekly",
      showSeconds: false,
      completionText: "Started",
    });
  });

  it("expands a repeat with dataset bindings and formatting", () => {
    const root: PresentationNode = {
      type: "column",
      children: [
        {
          type: "row",
          repeat: { dataset: "s1", limit: 10 },
          children: [
            { type: "text", binding: { source: "repeat", path: "title" } },
            {
              type: "text",
              binding: {
                source: "repeat",
                path: "price",
                format: "currency",
                precision: 2,
              },
            },
          ],
        },
      ],
    };
    const datasets = new Map([["s1", normalizeSource(typedSource("s1"), at)]]);
    const tree = renderPresentation(root, { datasets, at });
    const json = JSON.stringify(tree);
    expect(json).toContain("Coffee");
    expect(json).toContain("$3.50");
    expect(json).toContain("Tea");
  });

  // The Server compiles Clock, Date, and World Clock to a text node bound to environment
  // "currentTime" with the whole spec in the format string. Resolving the path alone yields
  // nothing, so missing these renders an empty string — a blank screen, not a broken one.
  it("projects a compiled clock binding as a self-updating clock node", () => {
    const tree = renderPresentation(
      {
        type: "text",
        props: { role: "metric", color: "#FFFFFF" },
        binding: {
          source: "environment",
          path: "currentTime",
          format: "time:24:true:America/New_York",
        },
      },
      { datasets: new Map(), at },
    );
    expect(tree).toMatchObject({
      t: "clock",
      timezone: "America/New_York",
      hour12: false,
      showSeconds: true,
    });
  });

  it("resolves a compiled date binding to the formatted date", () => {
    const tree = renderPresentation(
      {
        type: "text",
        binding: {
          source: "environment",
          path: "currentTime",
          format: "date:full:America/New_York",
        },
      },
      { datasets: new Map(), at },
    );
    expect(tree).toMatchObject({
      t: "text",
      value: "Wednesday, July 15, 2026",
    });
  });

  it("drops nodes failing a condition", () => {
    const root: PresentationNode = {
      type: "column",
      children: [
        {
          type: "text",
          binding: { source: "literal", value: "shown" },
          condition: {
            binding: { source: "literal", value: "5" },
            op: "greater_than",
            value: "3",
          },
        },
        {
          type: "text",
          binding: { source: "literal", value: "hidden" },
          condition: {
            binding: { source: "literal", value: "1" },
            op: "greater_than",
            value: "3",
          },
        },
      ],
    };
    const tree = renderPresentation(root, { datasets: new Map(), at });
    const json = JSON.stringify(tree);
    expect(json).toContain("shown");
    expect(json).not.toContain("hidden");
  });

  it("signals autoskip only after the last current or upcoming event", () => {
    const source: ManifestDataSource = {
      id: "calendar",
      name: "Calendar",
      provider: "calendar",
      configVersion: 1,
      configuration: {},
      dataDocument: {
        schemaVersion: 1,
        datasets: [
          {
            id: "records",
            kind: "records",
            fields: [
              { key: "title", label: "Title", type: "text" },
              { key: "start", label: "Start", type: "datetime" },
              { key: "end", label: "End", type: "datetime" },
            ],
            records: [
              {
                id: "future",
                values: {
                  title: { kind: "text", text: "Assembly" },
                  start: {
                    kind: "datetime",
                    datetime: "2026-07-15T17:00:00Z",
                  },
                  end: {
                    kind: "datetime",
                    datetime: "2026-07-15T18:00:00Z",
                  },
                },
              },
            ],
            cache: { usingCachedData: false, unavailable: false },
          },
        ],
      },
    };
    const widget: ManifestWidget = {
      assetId: "schedule",
      name: "School Schedule",
      provider: "schedule-board",
      configVersion: 1,
      configuration: {},
      presentation: {
        schemaVersion: 1,
        kind: "native",
        native: {
          root: {
            type: "surface",
            props: {
              autoSkipWhenEmpty: true,
              emptyCondition: {
                binding: {
                  source: "dataset",
                  dataset: "calendar:records",
                  path: "title",
                  selector: "current_or_next",
                  startField: "start",
                  endField: "end",
                },
                op: "empty",
              },
            },
          },
        },
      },
    };
    const dataSources = new Map([["calendar", source]]);
    expect(renderWidget(widget, { dataSources, at })!.autoSkip).toBe(false);
    expect(
      renderWidget(widget, {
        dataSources,
        at: new Date("2026-07-15T19:00:00Z"),
      })!.autoSkip,
    ).toBe(true);
  });

  it("applies the surface's content margins and author scale", () => {
    const surface = (props: Record<string, unknown>): PresentationNode => ({
      type: "surface",
      props: { backgroundColor: "#000000", ...props },
      children: [
        {
          type: "text",
          props: { role: "metric", color: "#ffffff" },
          binding: { source: "literal", value: "5d 3h" },
        },
      ],
    });
    const inset = (node: PresentationNode) => {
      const tree = renderPresentation(node, { datasets: new Map(), at }) as {
        children: {
          style: { width: number };
          children: { style: { fontSize: number } }[];
        }[];
      };
      return tree.children[0]!;
    };

    // Default padding leaves the content the center 80 percent at 1x type.
    const automatic = inset(surface({ paddingPercent: 10, textScale: 100 }));
    expect(automatic.style.width).toBe(80);
    const baseSize = automatic.children[0]!.style.fontSize;

    // Zero padding fills the Widget; the scale multiplies the type.
    const enlarged = inset(surface({ paddingPercent: 0, textScale: 250 }));
    expect(enlarged.style.width).toBe(100);
    expect(enlarged.children[0]!.style.fontSize).toBeCloseTo(baseSize * 2.5);

    // Out-of-range values clamp to the supported 25–500 / 0–40 percent range.
    const clamped = inset(surface({ paddingPercent: 90, textScale: 5_000 }));
    expect(clamped.style.width).toBe(20);
    expect(clamped.children[0]!.style.fontSize).toBeCloseTo(baseSize * 5);
  });
});

describe("renderLayout", () => {
  const manifest = {
    manifestVersion: 1,
    assets: [
      {
        assetId: "a1",
        variantId: "v1",
        mimeType: "image/jpeg",
        sha256: "x",
        fileSize: 10,
        downloadPath: "/api/v1/player/assets/a1/variants/v1",
      },
    ],
    playlists: [],
    websites: [],
    schedules: [],
  } as unknown as Manifest;

  it("projects placements into positioned zones and rejects bad schema", () => {
    const document: LayoutDocument = {
      schemaVersion: 2,
      canvas: {
        width: 1920,
        height: 1080,
        orientation: "landscape",
        backgroundColor: "#101418",
      },
      placements: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "asset",
          name: "bg",
          x: 0,
          y: 0,
          width: 960,
          height: 1080,
          layer: 0,
          opacity: 1,
          visible: true,
          locked: false,
          assetId: "a1",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          type: "primitive",
          name: "title",
          x: 960,
          y: 0,
          width: 960,
          height: 200,
          layer: 1,
          opacity: 1,
          visible: true,
          locked: false,
          primitive: {
            kind: "text",
            text: "Welcome",
            fontFamily: "Inter",
            fontSize: 72,
          },
        },
      ],
    };
    const payload = renderLayout(document, {
      manifest,
      widgets: new Map(),
      dataSources: new Map(),
      at,
    })!;
    expect(payload.zones).toHaveLength(2);
    expect(payload.zones[0]!.image?.src).toContain("tcmedia://variant/a1/v1");
    expect(JSON.stringify(payload.zones[1]!.render)).toContain("Welcome");

    // Wrong schema version → null (keeps previous presentation active).
    expect(
      renderLayout(
        { ...document, schemaVersion: 1 },
        {
          manifest,
          widgets: new Map(),
          dataSources: new Map(),
          at,
        },
      ),
    ).toBeNull();
  });
});
