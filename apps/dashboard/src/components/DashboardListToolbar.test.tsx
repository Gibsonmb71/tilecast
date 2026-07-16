// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardListToolbar, DashboardSearch } from "./DashboardListToolbar";

describe("DashboardListToolbar", () => {
  it("uses the shared compact toolbar and search classes", () => {
    const { container } = render(
      <DashboardListToolbar>
        <DashboardSearch
          value=""
          onValueChange={() => undefined}
          label="Search Widgets"
          placeholder="Search Widgets"
        />
      </DashboardListToolbar>,
    );

    expect(container.querySelector(".dashboard-list-toolbar")).not.toBeNull();
    expect(container.querySelector(".dashboard-search")).not.toBeNull();
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe(
      "Search Widgets",
    );
  });

  it("clears the current search value", () => {
    const onValueChange = vi.fn();
    render(
      <DashboardSearch
        value="clock"
        onValueChange={onValueChange}
        label="Search Widgets"
        placeholder="Search Widgets"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear search widgets" }),
    );
    expect(onValueChange).toHaveBeenCalledWith("");
  });
});
