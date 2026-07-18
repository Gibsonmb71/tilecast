// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client";
import type { Asset, User } from "../api/types";
import { WidgetProviderGallery } from "../content/SourceEditors";
import {
  AssetCollection,
  AssetOrganization,
  canManageContent,
  ContentEmpty,
  CreateOrganizerDialog,
  statusLabel,
} from "./ContentPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

function withQueryClient(children: React.ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

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

  it("shows folder and tag chips on organized asset cards", () => {
    const organized: Asset = {
      ...asset,
      folderId: "folder-1",
      tags: [{ id: "tag-1", name: "Lobby", color: "#dc2626" }],
    };
    render(
      <AssetCollection
        items={[organized]}
        view="grid"
        onSelect={vi.fn()}
        folderNames={new Map([["folder-1", "Campus A"]])}
      />,
    );
    expect(screen.getByText("Campus A")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
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

describe("asset organization", () => {
  it("assigns a tag to a single asset through bulk organize", async () => {
    vi.spyOn(api, "contentFolders").mockResolvedValue([]);
    vi.spyOn(api, "contentCollections").mockResolvedValue([]);
    vi.spyOn(api, "contentTags").mockResolvedValue([
      { id: "tag-1", name: "Lobby", color: "#dc2626", assetCount: 0 },
    ]);
    const organize = vi
      .spyOn(api, "bulkOrganize")
      .mockResolvedValue({ updated: 1 });
    const refreshed: Asset = {
      ...asset,
      tags: [{ id: "tag-1", name: "Lobby", color: "#dc2626" }],
    };
    vi.spyOn(api, "asset").mockResolvedValue(refreshed);
    const changed = vi.fn();
    render(
      withQueryClient(
        <AssetOrganization
          asset={asset}
          canManage
          csrf="csrf-token"
          onChanged={changed}
        />,
      ),
    );

    const tagChip = await screen.findByRole("button", { name: "Lobby" });
    expect(tagChip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tagChip);

    await waitFor(() =>
      expect(organize).toHaveBeenCalledWith(
        { assetIds: ["asset-1"], addTagIds: ["tag-1"] },
        "csrf-token",
      ),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledWith(refreshed));
  });

  it("moves an asset to a folder and reports failures", async () => {
    vi.spyOn(api, "contentFolders").mockResolvedValue([
      {
        id: "folder-1",
        name: "Campus A",
        description: "",
        assetCount: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    vi.spyOn(api, "contentCollections").mockResolvedValue([]);
    vi.spyOn(api, "contentTags").mockResolvedValue([]);
    vi.spyOn(api, "bulkOrganize").mockRejectedValue(
      new ApiError("The folder no longer exists.", 404, "not_found"),
    );
    render(
      withQueryClient(
        <AssetOrganization
          asset={asset}
          canManage
          csrf="csrf-token"
          onChanged={vi.fn()}
        />,
      ),
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Folder" }));
    await user.click(await screen.findByRole("option", { name: "Campus A" }));

    expect(
      await screen.findByText("The folder no longer exists."),
    ).toBeInTheDocument();
  });
});

describe("create organizer dialog", () => {
  it("creates a folder and surfaces API errors", async () => {
    const create = vi
      .spyOn(api, "createContentFolder")
      .mockRejectedValueOnce(
        new ApiError(
          "A folder with this name already exists.",
          409,
          "conflict",
        ),
      )
      .mockResolvedValueOnce({
        id: "folder-1",
        name: "Campus A",
        description: "",
        assetCount: 0,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
    const created = vi.fn();
    const close = vi.fn();
    render(
      withQueryClient(
        <CreateOrganizerDialog
          kind="folder"
          csrf="csrf-token"
          onClose={close}
          onCreated={created}
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Folder name"), {
      target: { value: "Campus A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(
      await screen.findByText("A folder with this name already exists."),
    ).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce();
    expect(create).toHaveBeenLastCalledWith(
      { name: "Campus A", description: "" },
      "csrf-token",
    );
  });

  it("sends the chosen color when creating a tag", async () => {
    const create = vi.spyOn(api, "createContentTag").mockResolvedValue({
      id: "tag-1",
      name: "Lobby",
      color: "#dc2626",
      assetCount: 0,
    });
    render(
      withQueryClient(
        <CreateOrganizerDialog
          kind="tag"
          csrf="csrf-token"
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Tag name"), {
      target: { value: "Lobby" },
    });
    fireEvent.change(screen.getByLabelText("Color"), {
      target: { value: "#dc2626" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        { name: "Lobby", color: "#dc2626" },
        "csrf-token",
      ),
    );
  });
});
