// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { WidgetDefinition, WidgetPresentation } from "../api/types";
import { GenericWidgetEditor } from "./GenericDefinitionEditors";
import { NativeAppEditor, WidgetProviderGallery } from "./SourceEditors";

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
  it("organizes Widget choices by what the editor wants to show", () => {
    renderEditor(
      <WidgetProviderGallery onChoose={vi.fn()} onClose={vi.fn()} page />,
    );

    expect(
      screen.getByText(
        "Choose what you want to show. If a Widget needs connected data, you can choose or create it in the next step.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Essentials" })).toBeTruthy();
    expect(
      screen.getByText("Simple Widgets that do not need a Data Source."),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Display connected data" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Choose how records should look. You can connect the data next.",
      ),
    ).toBeTruthy();
  });

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

    const contentSection = screen
      .getByRole("heading", { name: "Content and behavior" })
      .closest("section");
    expect(contentSection).toHaveClass("widget-editor__section");
    expect(contentSection).toContainElement(screen.getByText("Timezone"));
  });

  it("presents appearance controls as consistent subsections instead of a one-off fieldset", () => {
    renderEditor(
      <NativeAppEditor
        provider="clock"
        csrf="csrf"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        page
      />,
    );

    expect(screen.getByText("Size and spacing")).toBeTruthy();
    expect(screen.getByText("Colors")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Content sizing" })).toBeNull();
    expect(
      document.querySelectorAll(".widget-editor__subsection"),
    ).toHaveLength(2);
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
