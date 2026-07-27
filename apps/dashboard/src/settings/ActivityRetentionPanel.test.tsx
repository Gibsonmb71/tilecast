// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityRetentionPanel } from "./ActivityRetentionPanel";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ status: { csrfToken: "token" } }),
}));

const retention = {
  rawEventDays: 30,
  playbackSessionDays: 90,
  screenStateDays: 90,
  auditLogDays: 365,
  diagnosticMetadataDays: 30,
  updatedAt: "2026-07-26T00:00:00.000Z",
};

function renderPanel(onDirtyChange?: (dirty: boolean) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ActivityRetentionPanel editable onDirtyChange={onDirtyChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        handler(input instanceof Request ? input.url : String(input)),
      ),
    ),
  );
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ActivityRetentionPanel", () => {
  it("keeps the failure visible and offers a retry", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      return attempt === 1
        ? new Response(
            JSON.stringify({ error: { message: "Retention is unavailable." } }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          )
        : ok({ data: retention });
    });

    renderPanel();

    // The panel stays on screen and says what went wrong, rather than vanishing.
    expect(await screen.findByText("Retention is unavailable.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText(/Audit logs/)).toBeTruthy();
  });

  it("refuses to save a value outside its bounds", async () => {
    const user = userEvent.setup();
    stubFetch(() => ok({ data: retention }));
    renderPanel();

    const field = await screen.findByLabelText(/Audit logs/);
    await user.clear(field);
    await user.type(field, "5");

    expect(
      screen.getByText("Audit logs must be between 90 and 3650 days."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save retention" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("treats an emptied field as incomplete rather than as zero", async () => {
    const user = userEvent.setup();
    stubFetch(() => ok({ data: retention }));
    renderPanel();

    const field = await screen.findByLabelText(/Audit logs/);
    await user.clear(field);

    expect(screen.getByText("Audit logs is required.")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Save retention" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("tells the parent when an edit is unsaved", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    stubFetch(() => ok({ data: retention }));
    renderPanel(onDirtyChange);

    const field = await screen.findByLabelText(/Audit logs/);
    await user.clear(field);
    await user.type(field, "400");

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });
});
