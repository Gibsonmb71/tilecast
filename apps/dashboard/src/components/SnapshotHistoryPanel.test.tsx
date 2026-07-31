// @vitest-environment jsdom

import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { SnapshotHistoryPanel } from "./SnapshotHistoryPanel";
import { api } from "../api/client";

const proofNote = "Captured from Tilecast Player.";

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SnapshotHistoryPanel screenId="s1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Snapshot history", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("distinguishes history being off from nothing having happened", async () => {
    vi.spyOn(api, "screenSnapshots").mockResolvedValue({
      items: [],
      enabled: false,
      retentionDays: 7,
      maxPerScreen: 48,
      proofNote,
    });
    renderPanel();
    expect(await screen.findByText(/Snapshot history is off/)).toBeTruthy();
  });

  it("says an empty history is empty, not off, when it is enabled", async () => {
    vi.spyOn(api, "screenSnapshots").mockResolvedValue({
      items: [],
      enabled: true,
      retentionDays: 7,
      maxPerScreen: 48,
      proofNote,
    });
    renderPanel();
    expect(await screen.findByText(/No snapshots yet/)).toBeTruthy();
  });

  it("shows the configured retention", async () => {
    vi.spyOn(api, "screenSnapshots").mockResolvedValue({
      items: [
        {
          id: "n1",
          screenId: "s1",
          capturedAt: "2026-03-04T10:14:00Z",
          width: 1920,
          height: 1080,
          fileSize: 12345,
          trigger: "scheduled",
        },
      ],
      enabled: true,
      retentionDays: 7,
      maxPerScreen: 48,
      proofNote,
    });
    renderPanel();
    expect(
      await screen.findByText(/Retains up to 48 per screen for 7 days/),
    ).toBeTruthy();
  });

  it("marks a manual capture so it is not read as a scheduled one", async () => {
    vi.spyOn(api, "screenSnapshots").mockResolvedValue({
      items: [
        {
          id: "n1",
          screenId: "s1",
          capturedAt: "2026-03-04T10:14:00Z",
          width: 1920,
          height: 1080,
          fileSize: 12345,
          trigger: "manual",
        },
      ],
      enabled: true,
      retentionDays: 7,
      maxPerScreen: 48,
      proofNote,
    });
    renderPanel();
    expect(await screen.findByText(/manual/)).toBeTruthy();
  });
});
