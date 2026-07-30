// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("states what each capability can and cannot do", async () => {
    renderPanel();
    expect(
      await screen.findByText(/cannot create or delete a Data Source/),
    ).toBeTruthy();
  });

  it("shows the token once, with the warning that it is not shown again", async () => {
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
    expect(screen.getByText(/does not show it again/)).toBeTruthy();
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
