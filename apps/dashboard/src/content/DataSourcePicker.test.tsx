// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource, DataSourceDefinition } from "../api/types";
import { DataSourcePicker } from "./DataSourcePicker";

// The real Data Source editors are large provider-specific forms with their own network
// behavior. This suite is about the picker's contract with them: the editor is rendered in
// place, and whatever it saves becomes the picker's selection.
vi.mock("./DataSourceEditors", () => ({
  DataSourceEditor: ({
    provider,
    onSaved,
  }: {
    provider: string;
    onSaved: (value: { id: string }) => void;
  }) => (
    <div role="dialog" aria-label={`${provider} editor`}>
      <button type="button" onClick={() => onSaved({ id: "created-source" })}>
        Save {provider}
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const csvDefinition: DataSourceDefinition = {
  id: "csv",
  version: 1,
  name: "CSV",
  description: "Upload a spreadsheet export.",
  category: "Data",
  icon: "spreadsheet",
  configurationSchema: { fields: [] },
  defaultConfiguration: {},
  outputSchema: { kind: "records", fields: [] },
  adapterId: "csv_adapter",
  refreshBehavior: "interval",
};

const existing: DataSource = {
  id: "existing",
  provider: "csv",
  name: "Lunch rows",
  description: "",
  configVersion: 2,
  configuration: {},
  status: "ready",
  cachedRecordCount: 12,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function picker(sources: DataSource[]) {
  const onChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <DataSourcePicker
        value=""
        sources={sources}
        definitions={[csvDefinition]}
        csrf="csrf-token"
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { ...result, onChange };
}

describe("DataSourcePicker", () => {
  it("selects a source created in place, without leaving the editor", async () => {
    const { onChange } = picker([]);

    await userEvent.click(
      screen.getByRole("button", { name: /Connect new data/ }),
    );
    expect(
      screen.getByRole("dialog", { name: "Connect new data" }),
    ).toHaveClass("asset-details", "data-source-connect");
    await userEvent.click(screen.getByRole("button", { name: /CSV/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save csv" }));

    expect(onChange).toHaveBeenCalledWith("created-source");
    // The flow closes on save and hands control back to the form it was opened from.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers connecting new data alongside existing sources", () => {
    picker([existing]);

    expect(
      screen.getByRole("button", { name: /Connect new data/ }),
    ).toBeTruthy();
    const select = screen.getByText("Data Source").closest("label");
    expect(
      Array.from(select?.querySelectorAll("option") ?? []).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Select data…", "Lunch rows — CSV"]);
  });

  it("omits the empty option when a binding must always reference a source", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value="existing"
          sources={[existing]}
          definitions={[csvDefinition]}
          csrf="csrf-token"
          allowEmpty={false}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const field = screen.getByText("Data Source").closest("label");
    expect(
      Array.from(field?.querySelectorAll("option") ?? []).map(
        (option) => option.textContent,
      ),
    ).toEqual(["Lunch rows — CSV"]);
  });

  it("reports the selected source's status and cached record count", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value="existing"
          sources={[existing]}
          definitions={[csvDefinition]}
          csrf="csrf-token"
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Ready · 12 records")).toBeTruthy();
  });

  // Without an option carrying the stale id, the select would fall back to displaying the first
  // source, claiming data the record does not actually reference.
  it("reports a referenced source that is no longer available", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value="deleted-source"
          sources={[existing]}
          definitions={[csvDefinition]}
          csrf="csrf-token"
          allowEmpty={false}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const field = screen.getByText("Data Source").closest("label");
    const select = field?.querySelector("select");
    expect(select?.value).toBe("deleted-source");
    expect(
      Array.from(select?.options ?? []).map((option) => option.textContent),
    ).toEqual(["Unavailable Data Source", "Lunch rows — CSV"]);
    expect(screen.getByRole("alert")).toHaveTextContent("no longer available");
  });

  // With nothing compatible left, the empty state must not hide the fact that something is still
  // referenced.
  it("keeps the missing reference visible when no compatible source remains", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value="deleted-source"
          sources={[]}
          definitions={[csvDefinition]}
          csrf="csrf-token"
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No compatible data connected yet")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Connect new data/ }),
    ).toBeTruthy();
  });

  it("offers only providers the consumer accepts when connecting new data", async () => {
    const weatherDefinition: DataSourceDefinition = {
      ...csvDefinition,
      id: "weather",
      name: "Weather",
      description: "Cache a forecast.",
    };
    const onChange = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value=""
          sources={[]}
          definitions={[csvDefinition, weatherDefinition]}
          createProviders={["csv"]}
          csrf="csrf-token"
          onChange={onChange}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Connect new data/ }),
    );

    expect(screen.getByRole("button", { name: /CSV/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Weather/ })).toBeNull();
  });

  it("does not offer creation to an author without write access", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <DataSourcePicker
          value=""
          sources={[]}
          definitions={[csvDefinition]}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("No compatible data connected yet")).toBeTruthy();
    expect(
      screen.getByText("Ask an editor to connect a compatible Data Source."),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Connect new data/ }),
    ).toBeNull();
  });
});
