// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { DependencyGraphPage } from "./DependencyGraphPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("traces direct and transitive content dependencies", async () => {
  vi.spyOn(api, "dependencyGraph").mockResolvedValue({
    nodes: [
      { id: "data-1", type: "data_source", name: "Lunch menu" },
      { id: "widget-1", type: "widget", name: "Menu board" },
      { id: "layout-1", type: "layout", name: "Cafeteria layout" },
      { id: "screen-1", type: "screen", name: "Cafeteria TV" },
    ],
    edges: [
      {
        fromType: "data_source",
        fromId: "data-1",
        toType: "widget",
        toId: "widget-1",
        relationship: "provides data to",
      },
      {
        fromType: "widget",
        fromId: "widget-1",
        toType: "layout",
        toId: "layout-1",
        relationship: "used by",
      },
      {
        fromType: "layout",
        fromId: "layout-1",
        toType: "screen",
        toId: "screen-1",
        relationship: "assigned to",
      },
    ],
  });

  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <DependencyGraphPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("region", { name: "Visual dependency graph" }),
  ).toBeInTheDocument();
  expect(document.querySelectorAll(".dependency-edge")).toHaveLength(3);

  const lunchMenu = await screen.findByText("Lunch menu");
  fireEvent.click(lunchMenu.closest("button")!);
  expect(screen.getByText("3", { selector: "strong" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: /Menu boardWidget.*provides data to/,
    }),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByText("Cafeteria TV").closest("button")!);
  expect(screen.getByRole("link", { name: /Open/ })).toHaveAttribute(
    "href",
    "/screens/screen-1",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close inspector" }));
  expect(
    screen.queryByRole("region", {
      name: "Cafeteria TV dependency details",
    }),
  ).not.toBeInTheDocument();
});
