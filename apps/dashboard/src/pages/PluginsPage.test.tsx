// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountdownBarEditorPage, PluginsPage } from "./PluginsPage";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    status: {
      authenticated: true,
      csrfToken: "csrf",
      user: { id: "owner", name: "Owner", role: "owner" },
    },
  }),
}));

function renderRoute(element: ReactNode, path = "/plugins") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (path.endsWith("/plugins")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [
                  {
                    id: "countdown_bar",
                    name: "Countdown Bar",
                    description: "A timed bar.",
                    enabled: true,
                    instanceCount: 3,
                  },
                ],
              },
            }),
          ),
        );
      }
      const data = path.endsWith("/screens")
        ? { items: [], total: 0 }
        : path.includes("screen-groups")
          ? { items: [], total: 0, page: 1, pageSize: 100 }
          : { items: [], total: 0 };
      return Promise.resolve(new Response(JSON.stringify({ data })));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Plugins", () => {
  it("shows the installed Countdown Bar card and instance count", async () => {
    renderRoute(<PluginsPage />);
    expect(
      await screen.findByRole("heading", { name: "Countdown Bar" }),
    ).toBeVisible();
    expect(screen.getByText("3 configured instances")).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage plugin" })).toHaveAttribute(
      "href",
      "/plugins/countdown-bar",
    );
  });

  it("requires a target when a scoped instance is submitted", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() =>
      expect(screen.getByLabelText("Target type")).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText("Target type"), {
      target: { value: "screens" },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    expect(
      await screen.findByText("Choose at least one target."),
    ).toBeVisible();
  }, 10_000);
});
