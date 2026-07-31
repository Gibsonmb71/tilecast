// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlayerUpdatesPanel } from "./SettingsOperations";
import { api } from "../api/client";
import type { UpdateDeployment, UpdateDeploymentDetail } from "../api/types";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "csrf", user: { role: "owner" } } }),
}));

const deployment: UpdateDeployment = {
  id: "d1",
  name: "Tilecast Player 1.4.0",
  mode: "install_now",
  status: "active",
  createdAt: "2026-07-30T11:00:00Z",
  platform: "android",
  versionCode: 42,
  versionName: "1.4.0",
  targetCount: 6,
  succeededCount: 3,
  failedCount: 1,
  waitingForUserCount: 2,
  rolloutMode: "full",
  rolloutPhase: "full",
};

const detail: UpdateDeploymentDetail = {
  ...deployment,
  artifactSizeBytes: 1024,
  rolloutMode: "full",
  rolloutPhase: "full",
  canarySize: 0,
  screens: [
    {
      screenId: "s1",
      screenName: "Gym",
      previousVersionCode: 41,
      expectedVersionCode: 42,
      downloadedBytes: 0,
      state: "waiting_for_user",
      updatedAt: "2026-07-30T11:40:00Z",
      isCanary: false,
    },
  ],
};

function widen<T>(value: unknown) {
  return value as T;
}

describe("Player update deployment history", () => {
  beforeEach(() => {
    vi.spyOn(api, "playerReleases").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.playerReleases>>>({
        repository: "Gibsonmb71/tilecast",
        manifestKeyConfigured: true,
        githubAuth: {
          available: false,
          connected: false,
          source: "anonymous",
          canDisconnect: false,
        },
        items: [],
      }),
    );
    vi.spyOn(api, "updateDeployments").mockResolvedValue({
      items: [deployment],
    });
    vi.spyOn(api, "updateDeployment").mockResolvedValue(detail);
    vi.spyOn(api, "screens").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.screens>>>({ items: [], total: 0 }),
    );
    vi.spyOn(api, "screenGroups").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.screenGroups>>>({
        items: [],
        total: 0,
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderPanel() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={client}>
        <PlayerUpdatesPanel owner manageable />
      </QueryClientProvider>,
    );
  }

  it("says what the deployment needs rather than only counting", async () => {
    renderPanel();
    expect(await screen.findByText(/1 screen needs a retry/)).toBeTruthy();
    expect(screen.getByText("3 of 6 updated")).toBeTruthy();
    // The meter repeats itself as text so the segments are never colour alone.
    expect(
      screen.getByRole("img", {
        name: "3 Updated, 2 Waiting on someone, 1 Failed",
      }),
    ).toBeTruthy();
  });

  it("opens the per-screen drawer from the history row", async () => {
    renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: /6 screens/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: /Tilecast Player 1.4.0/ }),
    ).toBeTruthy();
    expect(screen.getByText("Needs approval on the TV")).toBeTruthy();
  });
});
