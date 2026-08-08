import { describe, expect, it } from "vitest";
import type { ContentDefinitionField } from "../api/types";
import {
  widgetPreviewConfiguration,
  widgetPreviewDataSourceIds,
} from "./widgetPreviewSources";

const fields: ContentDefinitionField[] = [
  {
    key: "rows",
    label: "Rows",
    control: "repeating_group",
    itemFields: [
      {
        key: "source",
        label: "Source",
        control: "data_source",
      },
    ],
  },
];

describe("Widget preview source resolution", () => {
  it("injects managed App source keys without changing author configuration", () => {
    const author = { heading: "Sports" };
    const preview = widgetPreviewConfiguration(author, "managed-source");

    expect(preview).toEqual({
      heading: "Sports",
      sourceId: "managed-source",
      managedDataSourceId: "managed-source",
    });
    expect(author).toEqual({ heading: "Sports" });
  });

  it("includes the managed source before recursively declared sources and de-duplicates IDs", () => {
    const configuration = {
      rows: [{ source: "nested-source" }, { source: "managed-source" }],
    };

    expect(
      widgetPreviewDataSourceIds(fields, configuration, "managed-source"),
    ).toEqual(["managed-source", "nested-source"]);
  });
});
