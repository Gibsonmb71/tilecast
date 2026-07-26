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

function renderNav(pathname = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[pathname]}>
        <SidebarNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const summary = (
  capabilities: FormSummary["grantedCapabilities"],
): FormSummary => ({
  id: "form-1",
  name: "Announcements",
  description: "",
  grantedCapabilities: capabilities,
  submissionCounts: { draft: 0, submitted: 0, changesRequested: 0, total: 0 },
});

describe("SidebarNavigation", () => {
  it("lists workspace facets beneath Content and Presentations", async () => {
    // A submitter-only form does not surface Approvals.
    vi.spyOn(api, "listForms").mockResolvedValue([summary(["submit"])]);
    renderNav();

    await waitFor(() => {
      expect(
        screen.getAllByRole("link").map((link) => link.textContent),
      ).toEqual([
        "Overview",
        "Screens",
        "Content",
        "Media",
        "Widgets",
        "Data",
        "Presentations",
        "Playlists",
        "Layouts",
        "Schedules",
        "Activity",
        "Settings",
      ]);
    });
    expect(
      screen
        .getByLabelText("Content submenu")
        .querySelectorAll('a[aria-current="page"]'),
    ).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Compose" })).toBeNull();
  });

  it("keeps a workspace highlighted while moving between its facets", () => {
    vi.spyOn(api, "listForms").mockResolvedValue([]);
    // /widgets belongs to Content, and NavLink alone would not match it.
    renderNav("/widgets/widget-1");

    expect(screen.getByRole("link", { name: "Content" }).className).toContain(
      "active",
    );
    expect(
      screen
        .getByRole("link", { name: "Widgets" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Presentations" }).className,
    ).not.toContain("active");
  });

  it("highlights Presentations for a Layout route", () => {
    vi.spyOn(api, "listForms").mockResolvedValue([]);
    renderNav("/layouts/layout-1");

    expect(
      screen.getByRole("link", { name: "Presentations" }).className,
    ).toContain("active");
    expect(
      screen
        .getByRole("link", { name: "Layouts" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Content" }).className,
    ).not.toContain("active");
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
