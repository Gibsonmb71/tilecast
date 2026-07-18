// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, User } from "../api/types";
import { WidgetProviderGallery } from "../content/SourceEditors";
import {
  AssetCollection,
  canManageContent,
  ContentEmpty,
  statusLabel,
} from "./ContentPage";

afterEach(cleanup);

const user = (role: User["role"]): User => ({
  id: "user",
  name: "Test User",
  username: "test",
  role,
  active: true,
  createdAt: "2026-01-01T00:00:00Z",
});

const asset: Asset = {
  id: "asset-1",
  name: "Welcome",
  description: "",
  type: "image",
  originalFilename: "welcome.png",
  declaredMimeType: "image/png",
  detectedMimeType: "image/png",
  sha256: "aabbcc",
  originalSize: 2048,
  width: 1920,
  height: 1080,
  metadata: {},
  processingStatus: "ready",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  variants: [],
};

describe("content library", () => {
  it("enforces viewer read-only behavior", () => {
    expect(canManageContent(user("owner"))).toBe(true);
    expect(canManageContent(user("administrator"))).toBe(true);
    expect(canManageContent(user("editor"))).toBe(true);
    expect(canManageContent(user("viewer"))).toBe(false);
  });

  it("renders a writable empty state", () => {
    const choose = vi.fn();
    render(<ContentEmpty canManage onChoose={choose} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
    expect(choose).toHaveBeenCalledOnce();
    expect(screen.getByText(/Drag images or videos/)).toBeInTheDocument();
  });

  it("explains the viewer restriction in the empty state", () => {
    render(<ContentEmpty canManage={false} onChoose={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Owner, Administrator, or Editor/),
    ).toBeInTheDocument();
  });

  it("renders grid and list collections with textual status", () => {
    const select = vi.fn();
    const { rerender } = render(
      <AssetCollection items={[asset]} view="grid" onSelect={select} />,
    );
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("1920 × 1080")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Welcome/ }));
    expect(select).toHaveBeenCalledWith(asset);
    rerender(<AssetCollection items={[asset]} view="list" onSelect={select} />);
    expect(
      document.querySelector(".asset-collection--list"),
    ).toBeInTheDocument();
  });

  it("renders a configured widget preview instead of an empty thumbnail", () => {
    const widget: Asset = {
      ...asset,
      id: "widget-1",
      name: "Lobby clock",
      type: "widget",
      originalFilename: "",
      widget: {
        provider: "clock",
        configVersion: 1,
        configuration: {
          timezone: "UTC",
          format: "24",
          showSeconds: false,
          foregroundColor: "#ffffff",
          backgroundColor: "#111111",
        },
      },
    };
    render(<AssetCollection items={[widget]} view="grid" onSelect={vi.fn()} />);
    expect(screen.getByText("clock")).toBeInTheDocument();
    const preview = document.querySelector<HTMLElement>(
      ".asset-widget-preview",
    );
    expect(preview?.style.getPropertyValue("--asset-widget-foreground")).toBe(
      "#ffffff",
    );
    expect(preview?.style.getPropertyValue("--asset-widget-background")).toBe(
      "#111111",
    );
  });

  it("renders asset thumbnails as non-draggable", () => {
    const image: Asset = { ...asset, thumbnailUrl: "/thumb.png" };
    render(<AssetCollection items={[image]} view="grid" onSelect={vi.fn()} />);
    expect(document.querySelector(".asset-preview img")).toHaveAttribute(
      "draggable",
      "false",
    );
  });

  it("falls back to a widget tile when a remote thumbnail fails", () => {
    const widget: Asset = {
      ...asset,
      id: "widget-2",
      type: "widget",
      thumbnailUrl: "/broken-thumbnail",
      widget: {
        provider: "website",
        configVersion: 1,
        configuration: {} as never,
      },
    };
    render(<AssetCollection items={[widget]} view="grid" onSelect={vi.fn()} />);
    fireEvent.error(document.querySelector(".asset-preview img")!);
    expect(screen.getByText("website")).toBeInTheDocument();
  });

  it("uses honest processing labels", () => {
    expect(statusLabel("queued")).toBe("Waiting");
    expect(statusLabel("inspecting")).toBe("Inspecting");
    expect(statusLabel("processing")).toBe("Processing");
    expect(statusLabel("failed")).toBe("Failed");
  });

  it("offers web, universal-information, and preset Widget entries", () => {
    const choose = vi.fn();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WidgetProviderGallery onChoose={choose} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /YouTube/ }));
    expect(choose).toHaveBeenCalledWith("youtube");
    expect(screen.getByText(/Display an approved webpage/)).toBeInTheDocument();
    expect(screen.getByText(/without an API key/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Website/ }));
    expect(choose).toHaveBeenCalledWith("website");
    fireEvent.click(screen.getByRole("button", { name: /Spotlight/ }));
    expect(choose).toHaveBeenCalledWith("spotlight");
    fireEvent.click(screen.getByRole("button", { name: /Leaderboard/ }));
    expect(choose).toHaveBeenCalledWith("list", "leaderboard");
  });
});
