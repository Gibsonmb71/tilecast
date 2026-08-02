// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import type { AssetList, LayoutList, PlaylistList } from "../api/types";
import { QuickPresentDialog } from "./QuickPresentDialog";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuickPresentDialog", () => {
  it("presents ready content with an explicit duration and destination", async () => {
    vi.spyOn(api, "playlists").mockResolvedValue({
      items: [
        {
          id: "playlist-1",
          name: "Open house",
          description: "",
          revision: 2,
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          items: [],
          itemCount: 3,
          warnings: [],
          layoutUsage: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } satisfies PlaylistList);
    vi.spyOn(api, "layouts").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    } satisfies LayoutList);
    vi.spyOn(api, "assets").mockResolvedValue({
      items: [
        {
          id: "website-1",
          name: "Status website",
          description: "",
          type: "widget",
          originalFilename: "",
          declaredMimeType: "application/json",
          detectedMimeType: "application/json",
          sha256: "",
          originalSize: 0,
          metadata: {},
          processingStatus: "ready",
          createdAt: "2026-07-01T00:00:00Z",
          updatedAt: "2026-07-01T00:00:00Z",
          variants: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    } satisfies AssetList);
    const create = vi
      .spyOn(api, "createPresentationOverride")
      .mockResolvedValue({
        id: "override-1",
        targetType: "group",
        targetId: "group-1",
        targetName: "Cafeteria",
        contentType: "playlist",
        contentId: "playlist-1",
        contentName: "Open house",
        durationSeconds: 900,
        startedAt: "2026-07-17T15:00:00Z",
        expiresAt: "2026-07-17T15:15:00Z",
        afterAction: "resume",
        wakeDisplay: false,
      });

    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <QuickPresentDialog
          open
          targetType="group"
          targetId="group-1"
          destinationName="Cafeteria"
          csrfToken="csrf"
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Open house · 3 items")).toBeInTheDocument();
    await user.click(
      screen.getByRole("tab", { name: "Media, widget, or website" }),
    );
    expect(
      await screen.findByRole("option", { name: "Status website · widget" }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole("tab")[0]!);
    await user.click(screen.getByLabelText("30 min"));
    await user.click(screen.getByRole("button", { name: "Show now" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        {
          targetType: "group",
          targetId: "group-1",
          contentType: "playlist",
          contentId: "playlist-1",
          durationMinutes: 30,
          afterAction: "resume",
          wakeDisplay: false,
        },
        "csrf",
      ),
    );
  });
});
