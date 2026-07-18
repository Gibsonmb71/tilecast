// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarNavigation } from "./Dashboard";

afterEach(cleanup);

describe("SidebarNavigation", () => {
  it("keeps priority destinations pinned and groups the content pipeline", () => {
    render(
      <MemoryRouter>
        <SidebarNavigation />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Content" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Compose" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [
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
      ],
    );
  });

  it("keeps Settings in a dedicated footer region", () => {
    render(
      <MemoryRouter>
        <SidebarNavigation />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Settings" }).parentElement?.className,
    ).toBe("sidebar__nav-footer");
  });
});
