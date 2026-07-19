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

function renderTopbar(
  path = "/",
  client?: QueryClient,
  overrides: {
    deployments?: Awaited<ReturnType<typeof api.updateDeployments>>;
    pairings?: Awaited<ReturnType<typeof api.pendingPairings>>;
  } = {},
) {
  vi.spyOn(api, "screens").mockResolvedValue({
    items: [lobbyScreen],
    total: 1,
  });
  vi.spyOn(api, "screen").mockResolvedValue(lobbyScreen);
  vi.spyOn(api, "updateDeployments").mockResolvedValue(
    overrides.deployments ?? { items: [] },
  );
  vi.spyOn(api, "pendingPairings").mockResolvedValue(
    overrides.pairings ?? { items: [], total: 0 },
  );
  vi.spyOn(api, "emergencies").mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(api, "assets").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
  });
  vi.spyOn(api, "backups").mockResolvedValue({
    backups: [],
    recentJobs: [],
    schedule: {},
  });
  client ??= new QueryClient({
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

  it("renders the breadcrumb name when a detail page cached the full entity under the shared key", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Detail pages cache the whole entity under ["screens", id]; the breadcrumb
    // shares this key and must derive a string label from it, never render it.
    client.setQueryData(["screens", "screen-1"], lobbyScreen);
    renderTopbar("/screens/screen-1", client);

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

  it("groups notifications by priority and surfaces new alert sources", async () => {
    renderTopbar("/", undefined, {
      deployments: {
        items: [
          {
            id: "dep-1",
            name: "Winter rollout",
            failedCount: 2,
            waitingForUserCount: 0,
          },
          {
            id: "dep-2",
            name: "Lobby canary",
            failedCount: 0,
            waitingForUserCount: 3,
          },
        ] as Awaited<ReturnType<typeof api.updateDeployments>>["items"],
      },
      pairings: {
        items: [{ id: "pair-1" }] as Awaited<
          ReturnType<typeof api.pendingPairings>
        >["items"],
        total: 1,
      },
    });

    // A failed deployment is critical, so the badge escalates to the critical style.
    const badge = await screen.findByText("4", {
      selector: ".topbar__notification-badge",
    });
    expect(badge.className).toContain("topbar__notification-badge--critical");

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(
      (
        await screen.findByRole("menuitem", { name: /Winter rollout/ })
      ).getAttribute("href"),
    ).toBe("/settings/player/updates");
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("Info")).toBeTruthy();
    expect(
      screen
        .getByRole("menuitem", { name: /Screens awaiting approval/ })
        .getAttribute("href"),
    ).toBe("/screens/pair");
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
