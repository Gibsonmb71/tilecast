// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountdownBarEditorPage, PluginsPage } from "./PluginsPage";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    status: {
      authenticated: true,
      csrfToken: "csrf",
      user: { id: "owner", name: "Owner", role: "owner" },
    },
  }),
}));

function renderRoute(element: ReactNode, path = "/plugins") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {/* Mirrors App.tsx, where "new" is a static route rather than an :id. */}
          <Route path="/plugins/countdown-bar/new" element={element} />
          <Route path="/plugins/countdown-bar/:id" element={element} />
          <Route path="*" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Signal Select hides its native control, so pick the way a person does. */
function chooseOption(selectLabel: string, optionLabel: string) {
  fireEvent.click(screen.getByLabelText(selectLabel));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

function pressedDays() {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].filter(
    (day) =>
      screen.getByRole("button", { name: day }).getAttribute("aria-pressed") ===
      "true",
  );
}

const storedInstance = {
  id: "bar-1",
  name: "Lunch",
  message: "Lunch ends in",
  scheduleType: "weekly",
  targetTime: "12:00",
  daysOfWeek: [1, 3],
  oneTimeAt: null,
  timezone: "America/New_York",
  leadTimeSeconds: 900,
  completionText: "",
  displayMode: "overlay",
  progressFill: "drain",
  heightPx: 72,
  enabled: true,
  priority: 0,
  targetScope: "all",
  targetIds: [],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

const submitted: Record<string, unknown>[] = [];

beforeEach(() => {
  submitted.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (init?.method && init.method !== "GET") {
        submitted.push(
          JSON.parse(
            typeof init.body === "string" ? init.body : "{}",
          ) as Record<string, unknown>,
        );
        return Promise.resolve(new Response(JSON.stringify({ data: {} })));
      }
      if (path.includes("/instances/bar-1")) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: storedInstance })),
        );
      }
      if (path.endsWith("/plugins")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [
                  {
                    id: "countdown_bar",
                    name: "Countdown Bar",
                    description: "A timed bar.",
                    enabled: true,
                    instanceCount: 3,
                  },
                  {
                    id: "emergency_alerts",
                    name: "Emergency Alerts",
                    description: "Watch official NWS weather alerts.",
                    enabled: false,
                    instanceCount: 1,
                  },
                  {
                    id: "forms",
                    name: "Forms",
                    description: "Collect submissions.",
                    enabled: true,
                    instanceCount: 2,
                  },
                ],
              },
            }),
          ),
        );
      }
      const data = path.endsWith("/screens")
        ? { items: [{ id: "screen-1", name: "Cafeteria" }], total: 1 }
        : path.includes("screen-groups")
          ? { items: [], total: 0, page: 1, pageSize: 100 }
          : { items: [], total: 0 };
      return Promise.resolve(new Response(JSON.stringify({ data })));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Plugins", () => {
  it("shows the installed Countdown Bar card and instance count", async () => {
    renderRoute(<PluginsPage />);
    expect(
      await screen.findByRole("heading", { name: "Countdown Bar" }),
    ).toBeVisible();
    expect(screen.getByText("3 configured instances")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Manage plugin" })[0],
    ).toHaveAttribute("href", "/plugins/countdown-bar");
  });

  it("lists Emergency Alerts as a plugin of its own", async () => {
    renderRoute(<PluginsPage />);
    const card = (
      await screen.findByRole("heading", { name: "Emergency Alerts" })
    ).closest("article")!;
    // Its rules are its instances, and monitoring being off is what makes the
    // plugin disabled — both are stated rather than left to be inferred.
    expect(within(card).getByText("1 configured alert rule")).toBeVisible();
    expect(within(card).getByText("Disabled")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Manage plugin" }),
    ).toHaveAttribute("href", "/plugins/emergency-alerts");
  });

  it("lists Forms as a plugin rather than a Data Source", async () => {
    renderRoute(<PluginsPage />);
    const card = (
      await screen.findByRole("heading", { name: "Forms" })
    ).closest("article")!;
    expect(within(card).getByText("2 configured forms")).toBeVisible();
    expect(
      within(card).getByRole("link", { name: "Manage plugin" }),
    ).toHaveAttribute("href", "/plugins/forms");
  });

  it("requires a target when a scoped instance is submitted", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() =>
      expect(screen.getByLabelText("Target type")).toBeEnabled(),
    );
    chooseOption("Target type", "Individual screens");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    expect(
      await screen.findByText("Choose at least one target."),
    ).toBeVisible();
  }, 10_000);

  it("submits the weekdays left selected after a day is toggled off", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    expect(pressedDays()).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));
    expect(pressedDays()).toEqual(["Mon", "Tue", "Thu", "Fri"]);
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.daysOfWeek).toEqual([1, 2, 4, 5]);
  }, 10_000);

  it("shows and preserves the days stored on an existing instance", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/bar-1");
    await waitFor(() =>
      expect(screen.getByLabelText("Name")).toHaveValue("Lunch"),
    );
    expect(pressedDays()).toEqual(["Mon", "Wed"]);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.daysOfWeek).toEqual([1, 3]);
    expect(submitted[0]?.progressFill).toBe("drain");
  }, 10_000);

  it("submits the checkbox groups it renders", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    fireEvent.click(screen.getByLabelText("Enabled"));
    chooseOption("Target type", "Individual screens");
    fireEvent.click(await screen.findByLabelText("Cafeteria"));
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.enabled).toBe(false);
    expect(submitted[0]?.targetIds).toEqual(["screen-1"]);
  }, 10_000);

  it("counts the chosen targets and explains an empty scope", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    chooseOption("Target type", "Individual screens");
    expect(await screen.findByText("0 of 1 selected")).toBeVisible();
    fireEvent.click(await screen.findByLabelText("Cafeteria"));
    expect(screen.getByText("1 of 1 selected")).toBeVisible();
    // No sync groups exist in this fixture, so the list must say so rather than
    // render an empty box.
    chooseOption("Target type", "Sync groups");
    expect(await screen.findByText("No sync groups exist yet.")).toBeVisible();
    expect(screen.getByText("0 of 0 selected")).toBeVisible();
  }, 10_000);

  it("submits the background countdown choice and preserves a stored one", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    chooseOption("Background countdown", "Drain right to left");
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.progressFill).toBe("drain");
  }, 10_000);

  it("keeps the schedule and mode selections across an unrelated edit", async () => {
    renderRoute(<CountdownBarEditorPage />, "/plugins/countdown-bar/new");
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeEnabled());
    chooseOption("Mode", "Push and shrink current content");
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lunch" },
    });
    // A weekday toggle re-renders the form; a select whose value was dropped
    // here would silently fall back to its first option.
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    expect(screen.getByLabelText("Target time")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create instance" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0]?.scheduleType).toBe("weekly");
    expect(submitted[0]?.displayMode).toBe("push");
  }, 10_000);
});
