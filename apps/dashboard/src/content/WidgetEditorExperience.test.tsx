// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { WidgetDefinition, WidgetPresentation } from "../api/types";
import { GenericWidgetEditor } from "./GenericDefinitionEditors";
import { NativeAppEditor } from "./SourceEditors";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const preview: WidgetPresentation = {
  schemaVersion: 1,
  kind: "native",
  requiredCapabilities: {},
  native: { root: { type: "text", props: { text: "Preview" } } },
};

function renderEditor(editor: ReactNode) {
  vi.spyOn(api, "compileWidgetPreview").mockResolvedValue(preview);
  vi.spyOn(api, "contentDefinitions").mockResolvedValue({
    revision: "1",
    compilerVersion: "1",
    fingerprint: "test",
    widgets: [],
    dataSources: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{editor}</QueryClientProvider>,
  );
}

describe("Widget editor experience", () => {
  it("groups built-in Widget settings and keeps a named live preview", () => {
    renderEditor(
      <NativeAppEditor
        provider="clock"
        csrf="csrf"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        page
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Widget details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Content and behavior" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Live preview" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Used to find this Widget in Content and playlists."),
    ).toBeTruthy();
    expect(
      screen.getByText(/Use an IANA timezone such as America\/New_York/),
    ).toBeTruthy();
  });

  it("uses the same guided structure for catalog-defined Widgets", () => {
    const definition = {
      id: "notice",
      version: 1,
      name: "Notice",
      description: "Show a short notice.",
      category: "Text",
      icon: "text",
      runtime: "native",
      configurationSchema: { fields: [] },
      defaultConfiguration: {},
      presentationSchemaVersion: 1,
      requiredCapabilities: {},
      emptyStateBehavior: "Show nothing",
    } satisfies WidgetDefinition;

    renderEditor(
      <GenericWidgetEditor
        definition={definition}
        csrf="csrf"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Widget details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Content and appearance" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Live preview" }),
    ).toBeTruthy();
  });
});
