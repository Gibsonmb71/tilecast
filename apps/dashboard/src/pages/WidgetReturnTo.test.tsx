// @vitest-environment jsdom
// Editing a shared Widget from inside a Layout used to ask for confirmation and then navigate to
// the Widget *list*, abandoning the Layout the author was building. The Widget editor now honors a
// returnTo path so closing lands back where the author came from.
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { Asset, ContentDefinitionCatalog } from "../api/types";
import { AuthProvider } from "../auth/AuthProvider";
import { WidgetEditorPage } from "./WidgetsPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function CurrentPath() {
  const location = useLocation();
  return (
    <div data-testid="path">{`${location.pathname}${location.search}`}</div>
  );
}

const widget = {
  id: "widget-1",
  name: "Today's Lunch",
  description: "",
  type: "widget",
  originalFilename: "",
  declaredMimeType: "application/json",
  detectedMimeType: "application/json",
  sha256: "aabb",
  originalSize: 0,
  metadata: {},
  processingStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  variants: [],
  playlistUsage: 1,
  playlistsUsing: [{ id: "playlist-1", name: "Cafeteria loop" }],
  layoutUsage: [{ id: "layout-1", name: "Cafeteria Layout", published: true }],
  widget: {
    provider: "website",
    configVersion: 1,
    configuration: {} as never,
  },
} as unknown as Asset;

function editorAt(url: string) {
  vi.spyOn(api, "asset").mockResolvedValue(widget);
  vi.spyOn(api, "contentDefinitions").mockResolvedValue({
    revision: "1",
    compilerVersion: "1",
    fingerprint: "abc",
    widgets: [
      {
        id: "website",
        version: 1,
        name: "Website",
        description: "Show a website.",
        category: "Web",
        icon: "globe",
        runtime: "web",
        configurationSchema: { fields: [] },
        defaultConfiguration: {},
        presentationSchemaVersion: 13,
        requiredCapabilities: {},
        legacyEditor: true,
      },
    ],
    dataSources: [],
  } as unknown as ContentDefinitionCatalog);
  vi.spyOn(api, "authStatus").mockResolvedValue({
    setupRequired: false,
    authenticated: true,
    csrfToken: "csrf",
    user: {
      id: "u1",
      name: "Owner",
      username: "owner",
      role: "owner",
      active: true,
      createdAt: "2026-01-01T00:00:00Z",
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <CurrentPath />
          <Routes>
            <Route path="/widgets/:id" element={<WidgetEditorPage />} />
            <Route path="/widgets" element={<div>Widget list</div>} />
            <Route path="/layouts/:id" element={<div>Layout editor</div>} />
            <Route path="/start/:job" element={<div>Guided job</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Widget editor returnTo", () => {
  it("returns to the Layout that opened the Widget", async () => {
    editorAt("/widgets/widget-1?returnTo=%2Flayouts%2Flayout-1");

    // The editor frame renders a header close control and a footer cancel; either exits.
    const [close] = await screen.findAllByRole("button", { name: /^Close$/ });
    await userEvent.click(close!);

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/layouts/layout-1"),
    );
  });

  it("falls back to the Widget list when no return path is given", async () => {
    editorAt("/widgets/widget-1");

    // The editor frame renders a header close control and a footer cancel; either exits.
    const [close] = await screen.findAllByRole("button", { name: /^Close$/ });
    await userEvent.click(close!);

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/widgets"),
    );
  });

  // returnTo arrives from the URL, so a protocol-relative or absolute value must not become an
  // off-site navigation target.
  it("ignores a return path that is not an in-app route", async () => {
    editorAt("/widgets/widget-1?returnTo=%2F%2Fevil.example.com");

    // The editor frame renders a header close control and a footer cancel; either exits.
    const [close] = await screen.findAllByRole("button", { name: /^Close$/ });
    await userEvent.click(close!);

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/widgets"),
    );
  });

  it("returns to a guided job with the saved Widget id", async () => {
    editorAt(
      "/widgets/widget-1?flowReturn=%2Fstart%2Flunch-menu%3Fscreen%3Dscreen-1",
    );

    vi.spyOn(api, "updateWidget").mockResolvedValue(widget);

    const save = await screen.findByRole("button", { name: "Save website" });
    await userEvent.click(save);

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent(
        "/start/lunch-menu?screen=screen-1&widget=widget-1",
      ),
    );
  });

  it("returns to a guided job when the editor is closed without saving", async () => {
    editorAt("/widgets/widget-1?flowReturn=%2Fstart%2Flunch-menu");

    const [close] = await screen.findAllByRole("button", { name: /^Close$/ });
    await userEvent.click(close!);

    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent("/start/lunch-menu"),
    );
  });

  it("reports the playlists and Layouts that use the Widget", async () => {
    editorAt("/widgets/widget-1");

    expect(
      await screen.findByRole("link", { name: /Cafeteria loop/ }),
    ).toHaveAttribute("href", "/playlists/playlist-1");
    expect(
      screen.getByRole("link", { name: /Cafeteria Layout/ }),
    ).toHaveAttribute("href", "/layouts/layout-1");
  });
});
