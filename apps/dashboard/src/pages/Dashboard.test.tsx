// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarNavigation } from "./Dashboard";
import { api } from "../api/client";
import type { FormSummary } from "../api/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderNav() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SidebarNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const summary = (capabilities: FormSummary["grantedCapabilities"]): FormSummary => ({
  id: "form-1",
  name: "Announcements",
  description: "",
  grantedCapabilities: capabilities,
  submissionCounts: { draft: 0, submitted: 0, changesRequested: 0, total: 0 },
});

describe("SidebarNavigation", () => {
  it("keeps priority destinations pinned and groups the content pipeline", async () => {
    // A submitter-only form does not surface Approvals.
    vi.spyOn(api, "listForms").mockResolvedValue([summary(["submit"])]);
    renderNav();

    expect(screen.getByRole("heading", { name: "Content" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Compose" })).toBeTruthy();
    await waitFor(() => {
      expect(
        screen.getAllByRole("link").map((link) => link.textContent),
      ).toEqual([
        "Overview",
        "Screens",
        "Media",
        "Widgets",
        "Data Sources",
        "Playlists",
        "Layouts",
        "Schedules",
        "Activity",
        "Settings",
      ]);
    });
  });

  it("keeps Settings in a dedicated footer region", () => {
    vi.spyOn(api, "listForms").mockResolvedValue([]);
    renderNav();

    expect(
      screen.getByRole("link", { name: "Settings" }).parentElement?.className,
    ).toBe("sidebar__nav-footer");
  });

  it("shows Approvals only when the user can review at least one form", async () => {
    vi.spyOn(api, "listForms").mockResolvedValue([summary(["review"])]);
    renderNav();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Approvals" })).toBeTruthy();
    });
  });
});
