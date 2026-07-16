// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import type { Asset } from "../../api/types";
import { ContentPicker } from "./ContentPicker";

const asset = (id: string, name: string, type: Asset["type"]): Asset => ({
  id,
  name,
  description: "",
  type,
  originalFilename: type === "widget" ? "" : `${name}.png`,
  declaredMimeType: type === "widget" ? "application/json" : "image/png",
  detectedMimeType: type === "widget" ? "application/json" : "image/png",
  sha256: "aabb",
  originalSize: 100,
  metadata: {},
  processingStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  variants: [],
  widget:
    type === "widget"
      ? { provider: "website", configVersion: 1, configuration: {} as never }
      : undefined,
});

const items = [
  asset("one", "Welcome", "image"),
  asset("two", "Menu", "widget"),
];

function picker(mode: "single" | "multiple", onConfirm = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContentPicker
        open
        mode={mode}
        csrf="csrf"
        confirmLabel="Add to playlist"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ContentPicker", () => {
  it("selects and confirms multiple reusable content items", async () => {
    vi.spyOn(api, "assets").mockResolvedValue({
      items,
      total: 2,
      page: 1,
      pageSize: 48,
    });
    const confirm = vi.fn().mockResolvedValue({ failures: [] });
    picker("multiple", confirm);
    fireEvent.click(await screen.findByRole("button", { name: /Welcome/ }));
    fireEvent.click(screen.getByRole("button", { name: /Menu/ }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add to playlist (2)" }),
    );
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(items));
  });

  it("keeps only the latest selection in single mode", async () => {
    vi.spyOn(api, "assets").mockResolvedValue({
      items,
      total: 2,
      page: 1,
      pageSize: 48,
    });
    picker("single");
    fireEvent.click(await screen.findByRole("button", { name: /Welcome/ }));
    fireEvent.click(screen.getByRole("button", { name: /Menu/ }));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(document.querySelector(".selected-content-tray")).toHaveTextContent(
      "Menu",
    );
    expect(
      document.querySelector(".selected-content-tray"),
    ).not.toHaveTextContent("Welcome");
  });
});
