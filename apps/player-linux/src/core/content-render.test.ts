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
