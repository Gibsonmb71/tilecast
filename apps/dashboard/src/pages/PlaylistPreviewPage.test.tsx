// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as authModule from "../auth/AuthProvider";
import { PlaylistPreviewPage } from "./PlaylistPreviewPage";
import { PLAYLIST_PREVIEW_FADE_MS } from "./PlaylistPreviewPage";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("renders only ready playlist items in the popup player", async () => {
  vi.spyOn(authModule, "useAuth").mockReturnValue({
    status: {
      authenticated: true,
      setupRequired: false,
      user: { id: "u1", name: "Owner", username: "owner", role: "owner" },
      csrfToken: "token",
    },
    isLoading: false,
  } as ReturnType<typeof authModule.useAuth>);
  vi.spyOn(api, "playlist").mockResolvedValue({
    id: "p1",
    name: "Lobby loop",
    description: "",
    revision: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    itemCount: 2,
    warnings: [],
    layoutUsage: [],
    items: [
      {
        id: "ready",
        assetId: "asset-1",
        position: 0,
        durationMs: 10_000,
        fitMode: "contain",
        transition: "fade",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "download",
        assetName: "Welcome",
        assetType: "image",
        assetStatus: "ready",
        thumbnailUrl: "/thumb-1",
      },
      {
        id: "processing",
        assetId: "asset-2",
        position: 1,
        durationMs: 10_000,
        fitMode: "contain",
        transition: "none",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "download",
        assetName: "Not ready",
        assetType: "image",
        assetStatus: "processing",
        thumbnailUrl: "/thumb-2",
      },
    ],
  });
  const router = createMemoryRouter(
    [
      {
        path: "/playlists/:id/preview",
        element: <PlaylistPreviewPage />,
      },
    ],
    { initialEntries: ["/playlists/p1/preview"] },
  );

  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("Lobby loop")).toBeInTheDocument();
  expect(screen.getByText("1 of 1 · Welcome")).toBeInTheDocument();
  expect(screen.queryByText("Not ready")).not.toBeInTheDocument();
  expect(screen.getByRole("presentation")).toHaveAttribute(
    "src",
    "/api/v1/assets/asset-1/preview",
  );
  expect(screen.getByRole("button", { name: "Pause preview" })).toBeEnabled();
});

it("keeps the outgoing item visible until the incoming crossfade item is ready", async () => {
  vi.spyOn(authModule, "useAuth").mockReturnValue({
    status: {
      authenticated: true,
      setupRequired: false,
      user: { id: "u1", name: "Owner", username: "owner", role: "owner" },
      csrfToken: "token",
    },
    isLoading: false,
  } as ReturnType<typeof authModule.useAuth>);
  vi.spyOn(api, "playlist").mockResolvedValue({
    id: "p1",
    name: "Crossfade loop",
    description: "",
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    itemCount: 2,
    warnings: [],
    layoutUsage: [],
    items: [
      {
        id: "first",
        assetId: "asset-1",
        position: 0,
        durationMs: 10_000,
        fitMode: "contain",
        transition: "none",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "download",
        assetName: "First",
        assetType: "image",
        assetStatus: "ready",
        thumbnailUrl: "/thumb-1",
      },
      {
        id: "second",
        assetId: "asset-2",
        position: 1,
        durationMs: 10_000,
        fitMode: "contain",
        transition: "crossfade",
        audioEnabled: false,
        volume: 0,
        deliveryPolicy: "download",
        assetName: "Second",
        assetType: "image",
        assetStatus: "ready",
        thumbnailUrl: "/thumb-2",
      },
    ],
  });
  const router = createMemoryRouter(
    [{ path: "/playlists/:id/preview", element: <PlaylistPreviewPage /> }],
    { initialEntries: ["/playlists/p1/preview"] },
  );

  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("1 of 2 · First")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next item" }));
  expect(screen.getByText("2 of 2 · Second")).toBeInTheDocument();
  expect(screen.getAllByRole("presentation")).toHaveLength(2);

  const incoming = screen
    .getAllByRole("presentation")
    .find((element) => element.getAttribute("src")?.includes("asset-2"));
  expect(incoming).toBeDefined();
  vi.useFakeTimers();
  fireEvent.load(incoming!);
  expect(
    document.querySelector(".playlist-preview-page__media--outgoing-active"),
  ).toBeInTheDocument();
  await act(() => vi.advanceTimersByTime(PLAYLIST_PREVIEW_FADE_MS));
  expect(screen.getAllByRole("presentation")).toHaveLength(1);
});
