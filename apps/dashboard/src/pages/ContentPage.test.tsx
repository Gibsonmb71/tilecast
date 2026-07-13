// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Asset, User } from "../api/types";
import { SourceProviderGallery } from "../content/SourceEditors";
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

  it("uses honest processing labels", () => {
    expect(statusLabel("queued")).toBe("Waiting");
    expect(statusLabel("inspecting")).toBe("Inspecting");
    expect(statusLabel("processing")).toBe("Processing");
    expect(statusLabel("failed")).toBe("Failed");
  });

  it("offers the built-in Website and YouTube Source providers", () => {
    const choose = vi.fn();
    render(<SourceProviderGallery onChoose={choose} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /YouTube/ }));
    expect(choose).toHaveBeenCalledWith("youtube");
    expect(screen.getByText(/Display a website/)).toBeInTheDocument();
    expect(screen.getByText(/without an API key/)).toBeInTheDocument();
  });
});
