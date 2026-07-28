// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { TakeoverPanel } from "./TakeoverPanel";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "token" } }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TakeoverPanel", () => {
  it("keeps NWS automation in Settings and exposes poll health", async () => {
    vi.spyOn(api, "nwsAlertSettings").mockResolvedValue({
      monitor: {
        enabled: true,
        areas: ["OH"],
        zones: [],
        pollIntervalSeconds: 120,
        lastPolledAt: "2026-07-28T12:00:00Z",
        lastSuccessAt: "2026-07-28T12:00:00Z",
        lastMatchedCount: 1,
        updatedAt: "2026-07-28T12:00:00Z",
      },
      rules: [],
      activeAlerts: [],
    });
    vi.spyOn(api, "screens").mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, "screenGroups").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(api, "playlists").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <TakeoverPanel editable />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "National Weather Service alerts",
      }),
    ).toBeTruthy();
    expect(await screen.findByDisplayValue("OH")).toBeTruthy();
    expect(await screen.findByText("Matched rules")).toBeTruthy();
    expect(
      screen.getByText(/best-effort, not a life-safety system/i),
    ).toBeTruthy();
  });
});
