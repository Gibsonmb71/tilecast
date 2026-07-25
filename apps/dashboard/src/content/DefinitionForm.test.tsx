// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type {
  ContentDefinitionCatalog,
  ContentDefinitionField,
  DataSource,
  DataSourceDefinition,
  DataSourceDetail,
} from "../api/types";
import {
  DefinitionForm,
  dataSourceKeysIn,
  resolveDataSourceKey,
} from "./DefinitionForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function definition(
  id: string,
  fields: { key: string; label: string; type: string }[],
): DataSourceDefinition {
  return {
    id,
    version: 1,
    name: `${id} source`,
    description: `Connect ${id} data.`,
    category: "Data",
    icon: "table",
    configurationSchema: { fields: [] },
    defaultConfiguration: {},
    outputSchema: { kind: "records", fields },
    adapterId: `${id}_adapter`,
    refreshBehavior: "interval",
  };
}

function source(id: string, provider: string, name: string): DataSource {
  return {
    id,
    provider,
    name,
    description: "",
    configVersion: 2,
    configuration: {},
    status: "ready",
    cachedRecordCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function detail(id: string, fields: DataSourceDetail["fields"]) {
  return {
    ...source(id, "csv", id),
    diagnostics: {} as DataSourceDetail["diagnostics"],
    fields,
    widgetUsage: [],
    bindingUsage: [],
  } as DataSourceDetail;
}

function catalog(dataSources: DataSourceDefinition[]) {
  return {
    revision: "1",
    compilerVersion: "1",
    fingerprint: "abc",
    widgets: [],
    dataSources,
  } as ContentDefinitionCatalog;
}

// The shared Select primitive renders a visually hidden native <select> behind a trigger button,
// so option text is read from that native element rather than through the option role.
function optionsFor(labelText: string | RegExp) {
  const field = screen.getByText(labelText).closest("label");
  const select = field?.querySelector("select");
  return Array.from(select?.options ?? []).map((option) => option.textContent);
}

function form(
  fields: ContentDefinitionField[],
  value: Record<string, unknown> = {},
) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <DefinitionForm
        fields={fields}
        value={value}
        onChange={onChange}
        csrf="csrf-token"
      />
    </QueryClientProvider>,
  );
  return { ...result, onChange };
}

describe("dataSourceKeysIn", () => {
  it("collects every Data Source a configuration references", () => {
    expect(
      dataSourceKeysIn(
        [
          { key: "primarySource", label: "Primary", control: "data_source" },
          { key: "compareSource", label: "Compare", control: "data_source" },
        ],
        { primarySource: "a", compareSource: "b" },
      ),
    ).toEqual(["a", "b"]);
  });

  // itemFields is recursive, so a Data Source inside a repeating group must still be found; missing
  // it would let the Widget editor save while that source's data was still loading.
  it("finds Data Sources nested inside a repeating group", () => {
    expect(
      dataSourceKeysIn(
        [
          { key: "primarySource", label: "Primary", control: "data_source" },
          {
            key: "rows",
            label: "Rows",
            control: "repeating_group",
            maximumItems: 4,
            itemFields: [
              { key: "rowSource", label: "Row data", control: "data_source" },
            ],
          },
        ],
        {
          primarySource: "a",
          rows: [{ rowSource: "b" }, { rowSource: "c" }, {}],
        },
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("reports each source once even when several fields share it", () => {
    expect(
      dataSourceKeysIn(
        [
          { key: "one", label: "One", control: "data_source" },
          { key: "two", label: "Two", control: "data_source" },
        ],
        { one: "same", two: "same" },
      ),
    ).toEqual(["same"]);
  });
});

describe("resolveDataSourceKey", () => {
  const sourceField: ContentDefinitionField = {
    key: "primarySource",
    label: "Primary",
    control: "data_source",
  };
  const secondSource: ContentDefinitionField = {
    key: "compareSource",
    label: "Compare",
    control: "data_source",
  };

  it("uses the single Data Source control when a definition declares one", () => {
    const field: ContentDefinitionField = {
      key: "valueField",
      label: "Value",
      control: "data_source_field",
    };
    expect(resolveDataSourceKey(field, [sourceField, field])).toBe(
      "primarySource",
    );
  });

  it("honors an explicit dataSourceKey when several sources exist", () => {
    const field: ContentDefinitionField = {
      key: "compareField",
      label: "Compare value",
      control: "data_source_field",
      dataSourceKey: "compareSource",
    };
    expect(
      resolveDataSourceKey(field, [sourceField, secondSource, field]),
    ).toBe("compareSource");
  });

  // Guessing here is what produced the original defect: a second field picker silently listed
  // the first source's schema. With no way to know, offer nothing.
  it("resolves nothing when several sources exist and the field does not say which", () => {
    const field: ContentDefinitionField = {
      key: "valueField",
      label: "Value",
      control: "data_source_field",
    };
    expect(
      resolveDataSourceKey(field, [sourceField, secondSource, field]),
    ).toBeUndefined();
  });
});

describe("DefinitionForm data source controls", () => {
  it("offers only Data Sources whose output schema the field accepts", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([
        definition("csv", [{ key: "title", label: "Title", type: "text" }]),
        definition("weather", [
          { key: "temperature", label: "Temperature", type: "number" },
        ]),
      ]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [
        source("s-csv", "csv", "Lunch rows"),
        source("s-weather", "weather", "Campus weather"),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });

    form([
      {
        key: "dataSourceId",
        label: "Data",
        control: "data_source",
        requiredFields: { temperature: "number" },
      },
    ]);

    await waitFor(() =>
      expect(optionsFor("Data")).toContain("Campus weather — Weather"),
    );
    expect(optionsFor("Data")).not.toContain("Lunch rows — CSV");
  });

  it("explains the empty state and offers to connect data instead of disabling the control", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([definition("csv", [])]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    form([{ key: "dataSourceId", label: "Data", control: "data_source" }]);

    await waitFor(() =>
      expect(screen.getByText("No compatible data connected yet")).toBeTruthy(),
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Connect new data/ }),
    ).toBeEnabled();
  });

  it("offers the compatible providers when connecting new data", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([definition("csv", []), definition("form", [])]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    form([{ key: "dataSourceId", label: "Data", control: "data_source" }]);

    const connect = await screen.findByRole("button", {
      name: /Connect new data/,
    });
    await userEvent.click(connect);

    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Connect new data",
    );
    expect(screen.getByRole("button", { name: /csv source/ })).toBeTruthy();
    // Form Data Sources are authored in the Forms portal, never through this editor.
    expect(screen.queryByRole("button", { name: /form source/ })).toBeNull();
  });

  // Without narrowing, an author could connect a provider the field then refuses, leaving them
  // with a new Data Source that does not appear in the picker they created it from.
  it("offers only providers the field accepts when connecting new data", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([
        definition("csv", [{ key: "title", label: "Title", type: "text" }]),
        definition("weather", [
          { key: "temperature", label: "Temperature", type: "number" },
        ]),
      ]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });

    form([
      {
        key: "dataSourceId",
        label: "Data",
        control: "data_source",
        requiredFields: { temperature: "number" },
      },
    ]);

    await userEvent.click(
      await screen.findByRole("button", { name: /Connect new data/ }),
    );

    expect(screen.getByRole("button", { name: /weather source/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /csv source/ })).toBeNull();
  });

  it("resolves each field picker against its own Data Source", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([definition("csv", [])]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [
        source("primary", "csv", "Primary"),
        source("compare", "csv", "Compare"),
      ],
      total: 2,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(api, "getDataSource").mockImplementation((id: string) =>
      Promise.resolve(
        id === "primary"
          ? detail("primary", [{ key: "lunch", label: "Lunch", type: "text" }])
          : detail("compare", [
              { key: "dinner", label: "Dinner", type: "text" },
            ]),
      ),
    );

    form(
      [
        { key: "primarySource", label: "Primary", control: "data_source" },
        { key: "compareSource", label: "Compare", control: "data_source" },
        {
          key: "primaryField",
          label: "Primary field",
          control: "data_source_field",
          dataSourceKey: "primarySource",
        },
        {
          key: "compareField",
          label: "Compare field",
          control: "data_source_field",
          dataSourceKey: "compareSource",
        },
      ],
      { primarySource: "primary", compareSource: "compare" },
    );

    // Each picker lists only its own source's fields. Before the fix both listed the source at
    // the hardcoded `dataSourceId` key, so the second picker showed the wrong schema.
    await waitFor(() =>
      expect(optionsFor("Primary field")).toContain("Lunch (text)"),
    );
    await waitFor(() =>
      expect(optionsFor("Compare field")).toContain("Dinner (text)"),
    );
    expect(optionsFor("Primary field")).not.toContain("Dinner (text)");
    expect(optionsFor("Compare field")).not.toContain("Lunch (text)");
  });

  it("tells the author to choose a Data Source before offering fields", async () => {
    vi.spyOn(api, "contentDefinitions").mockResolvedValue(
      catalog([definition("csv", [])]),
    );
    vi.spyOn(api, "listDataSources").mockResolvedValue({
      items: [source("primary", "csv", "Primary")],
      total: 1,
      page: 1,
      pageSize: 100,
    });

    form([
      { key: "primarySource", label: "Primary", control: "data_source" },
      {
        key: "primaryField",
        label: "Primary field",
        control: "data_source_field",
      },
    ]);

    await waitFor(() =>
      expect(optionsFor("Primary field")).toEqual([
        "Select a Data Source first",
      ]),
    );
  });
});
