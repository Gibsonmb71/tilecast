// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DataSourceDefinition } from "../api/types";
import { iconForIdentifier, resolveSetup, sourceIcon } from "./DataSourcesPage";

afterEach(cleanup);

// A release-defined Data Source whose provider ID is NOT present in any TypeScript union,
// hardcoded copy map, or icon switch. The open `DataSourceProvider` contract accepts it,
// and Studio must render it entirely from catalog metadata.
// The plain string ID assigns directly to DataSourceProvider, proving the union is open.
const fakeDefinition: DataSourceDefinition = {
  id: "campus-alert",
  version: 1,
  name: "Campus Alert",
  description: "Publish a campus-wide alert as a typed object.",
  category: "Information",
  icon: "beacon", // an icon identifier the Studio does not know
  configurationSchema: { fields: [] },
  defaultConfiguration: {},
  outputSchema: {
    kind: "object",
    fields: [{ key: "headline", label: "Headline", type: "text" }],
  },
  adapterId: "manual_object",
  refreshBehavior: "manual",
  requiresManifestV13: true,
  setup: {
    eyebrow: "Release-defined information",
    tip: "Keep alerts short and actionable.",
    steps: ["Enter the alert.", "Save and connect a Widget."],
  },
};

describe("release-defined Data Source Studio metadata", () => {
  it("resolves setup copy from catalog metadata for an ID not hardcoded in TypeScript", () => {
    const copy = resolveSetup(fakeDefinition.id, fakeDefinition);
    expect(copy.eyebrow).toBe("Release-defined information");
    expect(copy.description).toBe(
      "Publish a campus-wide alert as a typed object.",
    );
    expect(copy.tip).toBe("Keep alerts short and actionable.");
    expect(copy.steps).toHaveLength(2);
  });

  it("keeps hardcoded copy for legacy providers", () => {
    const legacy: DataSourceDefinition = {
      ...fakeDefinition,
      id: "calendar",
      legacyEditor: true,
    };
    const copy = resolveSetup("calendar", legacy);
    expect(copy.eyebrow).toBe("iCalendar feed");
  });

  it("falls back to a safe icon for an unknown icon identifier", () => {
    const { container } = render(iconForIdentifier("beacon"));
    // The default icon renders rather than crashing the gallery.
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("uses the definition icon for a release-defined source", () => {
    const { container } = render(sourceIcon(fakeDefinition.id, fakeDefinition));
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
