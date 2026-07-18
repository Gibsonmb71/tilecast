// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import { studioRoutes } from "../App";
import { api } from "../api/client";
import type { Screen } from "../api/types";
import { StudioRoutesProvider } from "../navigation/studioRoutes";
import { buildCommandResults, fuzzyScore, StudioTopbar } from "./StudioTopbar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

const lobbyScreen = {
  id: "screen-1",
  name: "Amazon AFTKRT",
  location: "Lobby",
  platform: "Fire TV",
  status: "offline",
} as Screen;

function LocationValue() {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

function renderTopbar(path = "/") {
  vi.spyOn(api, "screens").mockResolvedValue({
    items: [lobbyScreen],
    total: 1,
  });
  vi.spyOn(api, "screen").mockResolvedValue(lobbyScreen);
  vi.spyOn(api, "updateDeployments").mockResolvedValue({ items: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <StudioRoutesProvider routes={studioRoutes}>
          <StudioTopbar
            user={{
              id: "user-1",
              name: "Owner",
              username: "owner",
              role: "owner",
              active: true,
              createdAt: "2026-07-18T00:00:00Z",
            }}
          />
          <LocationValue />
        </StudioRoutesProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StudioTopbar", () => {
  it("builds a detail breadcrumb from the route hierarchy and entity data", async () => {
    renderTopbar("/screens/screen-1");

    expect(
      screen.getByRole("link", { name: "Screens" }).getAttribute("href"),
    ).toBe("/screens");
    expect(
      await screen.findByText("Amazon AFTKRT", {
        selector: '[aria-current="page"]',
      }),
    ).toBeTruthy();
  });

  it("opens search with the global shortcut and navigates with Enter", async () => {
    renderTopbar();
    await waitFor(() => expect(api.screens).toHaveBeenCalled());

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    const searchInput = await screen.findByRole("combobox", {
      name: "Search Tilecast",
    });
    fireEvent.change(searchInput, { target: { value: "Amazon" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByLabelText("Current route").textContent).toBe(
        "/screens/screen-1",
      ),
    );
  });

  it("shows active alerts and keeps global actions in the utility region", async () => {
    renderTopbar();

    expect(
      await screen.findByText("1", { selector: ".topbar__notification-badge" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pair screen" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Create/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(
      (
        await screen.findByRole("menuitem", { name: /Amazon AFTKRT/ })
      ).getAttribute("href"),
    ).toBe("/screens/screen-1");
  });

  it("offers creation actions for the full content workflow", () => {
    renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));

    expect(screen.getByRole("menuitem", { name: "Upload media" })).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: "Create widget" })
        .getAttribute("href"),
    ).toBe("/widgets/new");
    expect(
      screen
        .getByRole("menuitem", { name: "Create data source" })
        .getAttribute("href"),
    ).toBe("/data-sources/new");
    expect(
      screen
        .getByRole("menuitem", { name: "Create playlist" })
        .getAttribute("href"),
    ).toBe("/playlists?create=1");
    expect(
      screen
        .getByRole("menuitem", { name: "Create layout" })
        .getAttribute("href"),
    ).toBe("/layouts?create=1");
    expect(
      screen
        .getByRole("menuitem", { name: "Create schedule" })
        .getAttribute("href"),
    ).toBe("/schedules/new");
  });

  it("opens the existing upload workflow from Create", () => {
    renderTopbar();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Upload media" }));

    expect(screen.getByRole("dialog", { name: "Upload media" })).toBeTruthy();
  });
});

describe("command search", () => {
  it("fuzzy matches screens and route destinations", () => {
    expect(fuzzyScore("scrns", "Screens")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Screens")).toBe(-1);
    expect(
      buildCommandResults(studioRoutes, [lobbyScreen], "aftkrt")[0]?.to,
    ).toBe("/screens/screen-1");
  });
});
