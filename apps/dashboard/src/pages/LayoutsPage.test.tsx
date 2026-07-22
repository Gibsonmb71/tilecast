// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { LayoutsPage } from "./LayoutsPage";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "csrf-token" } }),
}));

vi.mock("../api/client", () => ({
  api: {
    layouts: vi.fn(),
    updateLayout: vi.fn(),
    createLayout: vi.fn(),
    saveLayoutDraft: vi.fn(),
    duplicateLayout: vi.fn(),
    deleteLayout: vi.fn(),
  },
}));

const layout = {
  id: "layout-1",
  name: "Lobby",
  description: "Welcome board",
  orientation: "landscape" as const,
  canvasWidth: 1920,
  canvasHeight: 1080,
  draftRevision: 2,
  publishedRevision: 1,
  createdAt: "2026-07-21T12:00:00Z",
  updatedAt: "2026-07-21T12:00:00Z",
  previewImageUrl: "/api/v1/layouts/layout-1/preview-image",
};

beforeEach(() => {
  vi.mocked(api.layouts).mockResolvedValue({
    items: [layout],
    total: 1,
    page: 1,
    pageSize: 100,
  });
  vi.mocked(api.updateLayout).mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <LayoutsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("shows the saved Layout render instead of rebuilding a live card preview", async () => {
  renderPage();
  expect(await screen.findByAltText("Preview of Lobby")).toHaveAttribute(
    "src",
    layout.previewImageUrl,
  );
});

it("renames a Layout from its card action", async () => {
  vi.spyOn(window, "prompt").mockReturnValue("Main Lobby");
  renderPage();
  await userEvent.click(
    await screen.findByRole("button", { name: "Rename Lobby" }),
  );
  expect(api.updateLayout).toHaveBeenCalledWith(
    "layout-1",
    { name: "Main Lobby", description: "Welcome board" },
    "csrf-token",
  );
});
