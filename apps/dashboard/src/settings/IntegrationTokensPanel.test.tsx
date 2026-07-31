// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntegrationTokensPanel } from "./IntegrationTokensPanel";
import { api } from "../api/client";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "csrf", user: { role: "owner" } } }),
}));

function renderPanel(owner = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <IntegrationTokensPanel owner={owner} />
    </QueryClientProvider>,
  );
}

describe("Integration tokens", () => {
  beforeEach(() => {
    const widen = <T,>(value: unknown) => value as T;
    vi.spyOn(api, "integrationTokens").mockResolvedValue([]);
    vi.spyOn(api, "listDataSources").mockResolvedValue(
      widen<Awaited<ReturnType<typeof api.listDataSources>>>({
        items: [{ id: "d1", name: "Lunch menu", provider: "manual" }],
        total: 1,
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps token management to the Owner", () => {
    renderPanel(false);
    expect(
      screen.getByText(/Only the Owner may manage integration tokens/),
    ).toBeTruthy();
  });

  it("describes each capability", async () => {
    renderPanel();
    expect(
      await screen.findByText(/Replace rows in selected Manual Table/),
    ).toBeTruthy();
  });

  it("marks a newly created token as shown once", async () => {
    vi.spyOn(api, "createIntegrationToken").mockResolvedValue({
      token: {
        id: "t1",
        name: "Menu importer",
        publicId: "abc",
        scopes: ["data_source:write"],
        dataSourceIds: [],
        createdAt: "2026-03-04T12:00:00Z",
      },
      secret: "tci_abc.supersecret",
      notice: "Copy this token now.",
    });
    renderPanel();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Menu importer");
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(await screen.findByText("tci_abc.supersecret")).toBeTruthy();
    expect(screen.getByText(/Shown once/)).toBeTruthy();
  });

  it("reports a revoked token as revoked and offers no revoke control", async () => {
    vi.spyOn(api, "integrationTokens").mockResolvedValue([
      {
        id: "t1",
        name: "Old importer",
        publicId: "abc",
        scopes: ["data_source:write"],
        dataSourceIds: [],
        createdAt: "2026-03-01T12:00:00Z",
        revokedAt: "2026-03-02T12:00:00Z",
      },
    ]);
    renderPanel();
    expect(await screen.findByText("Revoked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Revoke Old importer/ })).toBe(
      null,
    );
  });

  it("sends an expiry as the end of the chosen day, and none when left empty", async () => {
    const create = vi.spyOn(api, "createIntegrationToken").mockResolvedValue({
      token: {
        id: "t1",
        name: "Menu importer",
        publicId: "abc",
        scopes: ["data_source:write"],
        dataSourceIds: [],
        createdAt: "2026-03-04T12:00:00Z",
      },
      secret: "tci_abc.secret",
      notice: "",
    });
    renderPanel();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Menu importer");
    await user.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    // An empty field means a token that never expires, not one that expires now.
    expect(create.mock.calls[0]?.[0]?.expiresAt).toBeUndefined();

    // The name is cleared after a successful create, and it is required.
    await user.type(screen.getByLabelText("Name"), "Menu importer");
    fireEvent.change(screen.getByLabelText("Expires on"), {
      target: { value: "2027-06-30" },
    });
    await user.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const sent = create.mock.calls[1]?.[0]?.expiresAt;
    if (!sent) throw new Error("no expiry was sent");
    // The end of that day where the operator is, so a token set to expire on
    // the 30th still works through the 30th.
    const when = new Date(sent);
    expect(when.getFullYear()).toBe(2027);
    expect(when.getMonth()).toBe(5);
    expect(when.getDate()).toBe(30);
    expect(when.getHours()).toBe(23);
    // The last instant of the day, so nothing in the final second is cut off.
    expect(when.getMinutes()).toBe(59);
    expect(when.getSeconds()).toBe(59);
    expect(when.getMilliseconds()).toBe(999);
  });

  it("distinguishes an expired token from a revoked one", async () => {
    vi.spyOn(api, "integrationTokens").mockResolvedValue([
      {
        id: "t1",
        name: "Lapsed importer",
        publicId: "abc",
        scopes: ["data_source:write"],
        dataSourceIds: [],
        createdAt: "2020-03-01T12:00:00Z",
        expiresAt: "2020-04-01T12:00:00Z",
      },
    ]);
    renderPanel();
    // Expired, not revoked: nobody made a decision about this one, the date
    // simply passed.
    expect(await screen.findByText("Expired")).toBeTruthy();
    expect(screen.queryByText("Revoked")).toBe(null);
    expect(screen.getByText(/Expiry /)).toBeTruthy();
  });

  it("sends the named Data Source limits with a write token", async () => {
    const create = vi.spyOn(api, "createIntegrationToken").mockResolvedValue({
      token: {
        id: "t1",
        name: "Menu importer",
        publicId: "abc",
        scopes: ["data_source:write"],
        dataSourceIds: ["d1"],
        createdAt: "2026-03-04T12:00:00Z",
      },
      secret: "tci_abc.secret",
      notice: "",
    });
    renderPanel();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Menu importer");
    await user.click(
      await screen.findByRole("checkbox", { name: /Lunch menu/ }),
    );
    await user.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    const [body] = create.mock.calls[0] ?? [];
    expect(body?.dataSourceIds).toEqual(["d1"]);
  });
});
