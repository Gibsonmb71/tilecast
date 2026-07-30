// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as authModule from "../auth/AuthProvider";
import { FormsPluginPage } from "./FormsPluginPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Forms plugin", () => {
  it("lists accessible forms and links to canonical plugin routes", async () => {
    vi.spyOn(authModule, "useAuth").mockReturnValue({
      status: {
        authenticated: true,
        user: { id: "u1", name: "Owner", username: "owner", role: "owner" },
        csrfToken: "csrf",
      },
      isLoading: false,
    } as unknown as ReturnType<typeof authModule.useAuth>);
    vi.spyOn(api, "listForms").mockResolvedValue([
      {
        id: "form-1",
        name: "Staff announcements",
        description: "Collect announcements for review.",
        publishedRevisionNumber: 2,
        grantedCapabilities: ["manage"],
        submissionCounts: {
          draft: 0,
          submitted: 0,
          changesRequested: 0,
          total: 0,
        },
      },
    ]);

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <FormsPluginPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("link", { name: "Manage form" }),
    ).toHaveAttribute("href", "/plugins/forms/form-1");
    expect(screen.getByRole("link", { name: /Create form/ })).toHaveAttribute(
      "href",
      "/plugins/forms/new",
    );
  });
});
