// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import type { Asset, Playlist, Screen } from "../api/types";
import { AuthProvider } from "../auth/AuthProvider";
import { GuidedJobPage } from "./GuidedJobPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Path() {
  const location = useLocation();
  return (
    <div data-testid="path">{`${location.pathname}${location.search}`}</div>
  );
}

const screenRecord = { id: "screen-1", name: "Cafeteria TV" } as Screen;
const widgetRecord = {
  id: "widget-1",
  name: "Today's Lunch",
  type: "widget",
} as Asset;
const playlistRecord = {
  id: "playlist-1",
  name: "Today's Lunch",
  items: [],
} as unknown as Playlist;

function flowAt(url: string, role: "owner" | "viewer" = "owner") {
  vi.spyOn(api, "screens").mockResolvedValue({
    items: [screenRecord],
    total: 1,
  });
  vi.spyOn(api, "asset").mockResolvedValue(widgetRecord);
  vi.spyOn(api, "authStatus").mockResolvedValue({
    setupRequired: false,
    authenticated: true,
    csrfToken: "csrf",
    user: {
      id: "u1",
      name: "Owner",
      username: "owner",
      role,
      active: true,
      createdAt: "2026-01-01T00:00:00Z",
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Path />
          <Routes>
            <Route path="/start/:job" element={<GuidedJobPage />} />
            <Route path="/widgets/new/:provider" element={<div>Editor</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("GuidedJobPage", () => {
  it("asks where it plays before anything is built", async () => {
    flowAt("/start/lunch-menu");

    expect(await screen.findByText("Show a lunch menu")).toBeTruthy();
    expect(screen.getByText("Choose where it plays")).toBeTruthy();
    // The shared Select renders its options into a visually hidden native element.
    await waitFor(() => {
      const options = Array.from(
        document.querySelectorAll<HTMLOptionElement>("select option"),
      ).map((option) => option.textContent);
      expect(options).toContain("Cafeteria TV");
    });
  });

  // A derived title produced "Build the a lunch menu", so each job states its own label.
  it("names the build step in readable English", async () => {
    flowAt("/start/lunch-menu?screen=screen-1");

    expect(await screen.findByText("Build the menu board")).toBeTruthy();
  });

  it("hands the chosen screen to the Widget editor as a return path", async () => {
    flowAt("/start/lunch-menu?screen=screen-1");

    await userEvent.click(
      await screen.findByRole("button", { name: /Open the Widget editor/ }),
    );

    // The editor must know how to come back, and to which screen.
    await waitFor(() =>
      expect(screen.getByTestId("path")).toHaveTextContent(
        "/widgets/new/menu?flowReturn=%2Fstart%2Flunch-menu%3Fscreen%3Dscreen-1",
      ),
    );
  });

  it("creates a playlist, adds the Widget, and assigns it to the screen", async () => {
    const createPlaylist = vi
      .spyOn(api, "createPlaylist")
      .mockResolvedValue(playlistRecord);
    const addItem = vi
      .spyOn(api, "addPlaylistItem")
      .mockResolvedValue(playlistRecord);
    const assign = vi
      .spyOn(api, "assignPlaylist")
      .mockResolvedValue({} as Awaited<ReturnType<typeof api.assignPlaylist>>);

    flowAt("/start/lunch-menu?screen=screen-1&widget=widget-1");

    await userEvent.click(
      await screen.findByRole("button", { name: /Publish to the screen/ }),
    );

    await waitFor(() => expect(assign).toHaveBeenCalled());
    // The playlist is named after the Widget the author just built, and described by the job.
    expect(createPlaylist).toHaveBeenCalledWith(
      {
        name: "Today's Lunch",
        description:
          "Today's menu, read from a spreadsheet you already maintain.",
      },
      "csrf",
    );
    // Widgets carry no intrinsic duration, so the item must set one.
    expect(addItem).toHaveBeenCalledWith(
      "playlist-1",
      expect.objectContaining({ assetId: "widget-1", durationMs: 30_000 }),
      "csrf",
    );
    expect(assign).toHaveBeenCalledWith("screen-1", "playlist-1", "csrf");
    expect(
      await screen.findByText(/Cafeteria TV is now playing Today's Lunch/),
    ).toBeTruthy();
  });

  // Assignment is refused on its own — most often an out-of-date Player. The playlist still
  // exists, so the flow must say so rather than implying nothing was created.
  it("reports a partial result when only the assignment fails", async () => {
    vi.spyOn(api, "createPlaylist").mockResolvedValue(playlistRecord);
    vi.spyOn(api, "addPlaylistItem").mockResolvedValue(playlistRecord);
    vi.spyOn(api, "assignPlaylist").mockRejectedValue(
      new ApiError(
        "Player 0.2.0 cannot render this Widget.",
        409,
        "incompatible_player",
      ),
    );

    flowAt("/start/lunch-menu?screen=screen-1&widget=widget-1");

    await userEvent.click(
      await screen.findByRole("button", { name: /Publish to the screen/ }),
    );

    expect(
      await screen.findByText(/could not be assigned to Cafeteria TV/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Player 0.2.0 cannot render this Widget/),
    ).toBeTruthy();
    // The playlist is still reachable.
    expect(
      screen.getByRole("link", { name: /Open the playlist/ }),
    ).toHaveAttribute("href", "/playlists/playlist-1");
  });

  it("skips assignment when the author decides the screen later", async () => {
    vi.spyOn(api, "createPlaylist").mockResolvedValue(playlistRecord);
    vi.spyOn(api, "addPlaylistItem").mockResolvedValue(playlistRecord);
    const assign = vi.spyOn(api, "assignPlaylist");

    flowAt("/start/lunch-menu?screen=later&widget=widget-1");

    await userEvent.click(
      await screen.findByRole("button", { name: /Create the playlist/ }),
    );

    expect(
      await screen.findByText(/ready to assign whenever a screen is paired/),
    ).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not offer the flow to someone who cannot create content", async () => {
    flowAt("/start/lunch-menu", "viewer");

    expect(
      await screen.findByText("You do not have permission to create content"),
    ).toBeTruthy();
  });

  it("rejects an unknown job rather than rendering an empty flow", async () => {
    flowAt("/start/not-a-job");

    expect(
      await screen.findByText("That guided job is not available."),
    ).toBeTruthy();
  });
});
