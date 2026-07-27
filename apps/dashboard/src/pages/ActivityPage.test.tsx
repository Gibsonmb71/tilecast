// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityPage } from "./ActivityPage";
import { api } from "../api/client";

const authStatus = {
  authenticated: true,
  csrfToken: "token",
  user: { id: "user-1", name: "Owner", role: "owner" },
};

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: authStatus }),
}));

// The uptime panel has its own coverage; it is noise in these cases.
vi.mock("../components/FleetUptimePanel", () => ({
  FleetUptimePanel: () => <div data-testid="uptime" />,
}));

const cards = {
  screensReportingNormally: 12,
  screensWithPlaybackGaps: 2,
  confirmedPlaybackDurationMs: 7_200_000,
  playbackFailures: 5,
  interruptedPlays: 1,
  emergencyActivations: 0,
  failedPlayerUpdates: 0,
  recentAdministrativeChanges: 4,
};

/** The comparison window returns smaller numbers, so deltas are non-zero. */
const previousCards = { ...cards, playbackFailures: 2 };

function overviewBody(request: string) {
  const to = new URL(request, "http://localhost").searchParams.get("to")!;
  // The comparison request asks for the window ending where this one starts.
  const isPrevious = Date.parse(to) < Date.now() - 12 * 3_600_000;
  return {
    data: {
      range: { from: "", to: "" },
      cards: isPrevious ? previousCards : cards,
      needsAttention: [
        {
          screenId: "screen-1",
          screenName: "Lobby north",
          kind: "not_reporting",
          severity: "warning",
          description: "Playback stalled.",
          occurredAt: "2026-07-26T09:00:00.000Z",
        },
        {
          screenId: "screen-2",
          screenName: "Cafeteria",
          kind: "not_reporting",
          severity: "critical",
          description: "Screen is not reporting.",
          occurredAt: "2026-07-26T08:00:00.000Z",
        },
      ],
      timeline: [],
    },
  };
}

function renderPage(path = "/activity") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/activity"
            element={
              <>
                <ActivityPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output>{location.search}</output>;
}

beforeEach(() => {
  vi.spyOn(api, "screens").mockResolvedValue({
    items: [{ id: "screen-1", name: "Lobby north" }],
  } as never);
  vi.spyOn(api, "screenGroups").mockResolvedValue({
    items: [{ id: "group-1", name: "Main building" }],
  } as never);
  vi.spyOn(api, "users").mockResolvedValue({ items: [] } as never);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = url.includes("/activity/overview")
        ? overviewBody(url)
        : { data: { items: [], nextCursor: "" } };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Activity overview", () => {
  it("states the comparison period on a metric that moved", async () => {
    renderPage();

    await waitFor(() =>
      expect(screen.getByText(/Up 3 from previous 24 hours/)).toBeTruthy(),
    );
  });

  it("orders unresolved issues by severity, most urgent first", async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText("Cafeteria")).toBeTruthy());
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent ?? "")
      .filter((text) => text.includes("Cafeteria") || text.includes("Lobby"));
    expect(names[0]).toContain("Cafeteria");
  });

  it("links a metric to the records behind it", async () => {
    renderPage();

    await waitFor(() =>
      expect(
        screen
          .getByRole("link", { name: /Playback failures/ })
          .getAttribute("href"),
      ).toBe("/activity?tab=proof&result=failed"),
    );
  });
});

describe("Activity filters", () => {
  it("puts a filter in the URL so the view can be shared", async () => {
    const user = userEvent.setup();
    renderPage("/activity?tab=proof");

    await user.click(await screen.findByRole("combobox", { name: "Screen" }));
    await user.click(screen.getByRole("option", { name: "Lobby north" }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "screen=screen-1",
      ),
    );
  });

  it("shows an active filter as a chip and clears it", async () => {
    const user = userEvent.setup();
    renderPage("/activity?tab=proof&screen=screen-1");

    const chip = await screen.findByRole("button", {
      name: /Remove filter Screen: Lobby north/,
    });
    await user.click(chip);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).not.toContain("screen="),
    );
  });

  it("drops a filter the next tab cannot apply when switching tabs", async () => {
    const user = userEvent.setup();
    renderPage("/activity?tab=proof&screen=screen-1&media=asset-1");

    await user.click(await screen.findByRole("button", { name: "Audit Log" }));

    await waitFor(() => {
      const search = screen.getByRole("status").textContent ?? "";
      expect(search).toContain("tab=audit");
      expect(search).not.toContain("screen=");
      expect(search).not.toContain("media=");
    });
  });

  it("chips an advanced filter even though its control is behind a disclosure", async () => {
    renderPage("/activity?tab=proof&media=asset-1");

    expect(
      await screen.findByRole("button", {
        name: /Remove filter Media: asset-1/,
      }),
    ).toBeTruthy();
  });
});
