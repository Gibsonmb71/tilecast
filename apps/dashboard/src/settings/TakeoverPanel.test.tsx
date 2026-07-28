// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { emergencyPlaylistLabel, TakeoverPanel } from "./TakeoverPanel";

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
        <MemoryRouter>
          <TakeoverPanel editable />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Automated weather alerts",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Manage emergency playlists" })
        .getAttribute("href"),
    ).toBe("/playlists");
    expect(
      screen
        .getByRole("link", { name: "Start a Takeover now" })
        .getAttribute("href"),
    ).toBe("/screens");
    expect(await screen.findByDisplayValue("OH")).toBeTruthy();
    expect(await screen.findByText("Matched rules")).toBeTruthy();
    expect(
      screen.getByText(/best-effort, not a life-safety system/i),
    ).toBeTruthy();
  });

  it("disables NWS monitor controls and management actions when read-only", async () => {
    vi.spyOn(api, "nwsAlertSettings").mockResolvedValue({
      monitor: {
        enabled: true,
        areas: ["OH"],
        zones: ["OHC049"],
        pollIntervalSeconds: 120,
        lastMatchedCount: 0,
        updatedAt: "2026-07-28T12:00:00Z",
      },
      rules: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Tornadoes",
          enabled: true,
          eventNames: ["Tornado Warning"],
          minimumSeverity: "Severe",
          minimumUrgency: "Expected",
          playlistId: "22222222-2222-4222-8222-222222222222",
          playlistName: "Emergency",
          maximumDurationMinutes: 360,
          screenIds: [],
          groupIds: [],
          createdAt: "2026-07-28T12:00:00Z",
          updatedAt: "2026-07-28T12:00:00Z",
        },
      ],
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
        <MemoryRouter>
          <TakeoverPanel editable={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByLabelText("Automated NWS monitoring"),
    ).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("States and territories")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Counties or forecast zones")).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByLabelText("Poll interval")).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("button", { name: "Save NWS monitor" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Check now" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("normalizes area and zone codes before saving the monitor", async () => {
    vi.spyOn(api, "nwsAlertSettings").mockResolvedValue({
      monitor: {
        enabled: true,
        areas: [],
        zones: [],
        pollIntervalSeconds: 120,
        lastMatchedCount: 0,
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
    const update = vi.spyOn(api, "updateNWSAlertMonitor").mockResolvedValue({
      enabled: true,
      areas: ["OH", "PA"],
      zones: ["OHC049", "PAZ001"],
      pollIntervalSeconds: 120,
      lastMatchedCount: 0,
      updatedAt: "2026-07-28T12:00:00Z",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TakeoverPanel editable />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const areas = await screen.findByLabelText("States and territories");
    const zones = screen.getByLabelText("Counties or forecast zones");
    await user.type(areas, " oh, PA, ,");
    await user.type(zones, " ohc049, PAZ001, ");
    await user.click(screen.getByRole("button", { name: "Save NWS monitor" }));

    expect(update).toHaveBeenCalledWith(
      {
        enabled: true,
        areas: ["OH", "PA"],
        zones: ["OHC049", "PAZ001"],
        pollIntervalSeconds: 120,
      },
      "token",
    );
  });

  it("preserves comma-separated event text until rule submission", async () => {
    vi.spyOn(api, "nwsAlertSettings").mockResolvedValue({
      monitor: {
        enabled: false,
        areas: [],
        zones: [],
        pollIntervalSeconds: 120,
        lastMatchedCount: 0,
        updatedAt: "2026-07-28T12:00:00Z",
      },
      rules: [],
      activeAlerts: [],
    });
    vi.spyOn(api, "screens").mockResolvedValue({
      items: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Lobby",
          description: "",
          location: "",
          platform: "android-tv",
          deviceManufacturer: "Test",
          deviceModel: "TV",
          androidVersion: "14",
          playerVersion: "1.0",
          screenWidth: 1920,
          screenHeight: 1080,
          density: 1,
          locale: "en-US",
          timezone: "UTC",
          enabled: true,
          pairedAt: "2026-07-28T12:00:00Z",
          status: "online",
          hasActiveCredential: true,
        },
      ],
      total: 1,
    });
    vi.spyOn(api, "screenGroups").mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(api, "playlists").mockResolvedValue({
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Weather alert",
          description: "",
          revision: 1,
          createdAt: "2026-07-28T12:00:00Z",
          updatedAt: "2026-07-28T12:00:00Z",
          items: [],
          itemCount: 1,
          warnings: [],
          layoutUsage: [],
        },
      ],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const create = vi.spyOn(api, "createNWSAlertRule").mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Warnings",
      enabled: true,
      eventNames: ["Tornado Warning", "Flash Flood Warning"],
      minimumSeverity: "Severe",
      minimumUrgency: "Expected",
      playlistId: "22222222-2222-4222-8222-222222222222",
      playlistName: "Weather alert",
      maximumDurationMinutes: 360,
      screenIds: ["11111111-1111-4111-8111-111111111111"],
      groupIds: [],
      createdAt: "2026-07-28T12:00:00Z",
      updatedAt: "2026-07-28T12:00:00Z",
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TakeoverPanel editable />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Weather event rules" });
    await user.type(screen.getByLabelText("Rule name"), "Warnings");
    const eventNames = screen.getByLabelText("NWS event names");
    await user.clear(eventNames);
    await user.type(eventNames, "Tornado Warning, Flash Flood Warning");
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: /Pre-made emergency playlist/,
      }),
      "22222222-2222-4222-8222-222222222222",
    );
    await user.click(await screen.findByLabelText("Lobby"));
    await user.click(screen.getByRole("button", { name: "Add rule" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventNames: ["Tornado Warning", "Flash Flood Warning"],
      }),
      "token",
    );
  });

  it("makes playlist readiness visible before a weather rule is saved", () => {
    expect(emergencyPlaylistLabel({ name: "Tornado", itemCount: 3 })).toBe(
      "Tornado — 3 items",
    );
    expect(
      emergencyPlaylistLabel({ name: "Closure draft", itemCount: 0 }),
    ).toBe("Closure draft — empty, add content first");
  });
});
