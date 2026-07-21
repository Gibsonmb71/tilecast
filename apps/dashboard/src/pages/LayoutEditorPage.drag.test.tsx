// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import * as authModule from "../auth/AuthProvider";
import type { Layout, LayoutDocument } from "../api/types";
import { createPrimitivePlacement, LayoutEditorPage } from "./LayoutEditorPage";

// These tests exercise the pointer-drag move handler inside LayoutEditorPage,
// specifically the "snap first, then clamp" ordering used when dragging a
// placement: clamping must run last so an edge-placed item can never be
// snapped back outside the canvas (see LayoutEditorPage.tsx beginMove/move).

const canvas: LayoutDocument["canvas"] = {
  width: 1920,
  height: 1080,
  orientation: "landscape",
  backgroundColor: "#101820",
  safeAreaPercent: 5,
};

// A width/height that is not a multiple of 10 so `canvas.width - width` and
// `canvas.height - height` are not multiples of 10 either. This is what
// exposes the bug: snapping the clamped edge position rounds it back out of
// bounds.
function buildLayout(): Layout {
  const placement = {
    ...createPrimitivePlacement("text", canvas),
    x: 100,
    y: 100,
    width: 105,
    height: 155,
  };
  return {
    id: "layout-1",
    name: "Lobby",
    description: "",
    orientation: "landscape",
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    draft: { schemaVersion: 2, canvas, placements: [placement] },
    draftRevision: 1,
    dependencies: [],
    usage: { screens: [], schedules: [] },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function mockAuth() {
  vi.spyOn(authModule, "useAuth").mockReturnValue({
    status: {
      authenticated: true,
      user: { id: "u1", name: "User", username: "user", role: "owner" },
      csrfToken: "tok",
    },
    isLoading: false,
  } as unknown as ReturnType<typeof authModule.useAuth>);
}

function renderLayoutEditor() {
  const layout = buildLayout();
  vi.spyOn(api, "layout").mockResolvedValue(layout);
  vi.spyOn(api, "assets").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  vi.spyOn(api, "playlists").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  vi.spyOn(api, "listDataSources").mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 100,
  });
  vi.spyOn(api, "saveLayoutDraft").mockResolvedValue({
    draftRevision: 2,
  } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/layouts/layout-1"]}>
        <Routes>
          <Route path="/layouts/:id" element={<LayoutEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Drags the placement by an absolute pixel delta. The stage bounds are
// mocked to exactly match the canvas size, so a `bounds` delta of 1 client
// pixel maps to exactly 1 canvas pixel, keeping the arithmetic simple.
function dragBy(placementEl: Element, dx: number, dy: number) {
  fireEvent.pointerDown(placementEl, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: dx, clientY: dy, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: dx, clientY: dy, pointerId: 1 });
}

function pctOfWidth(value: number) {
  return (value / canvas.width) * 100;
}
function pctOfHeight(value: number) {
  return (value / canvas.height) * 100;
}

beforeEach(() => {
  // jsdom reports all zeroes for layout geometry; give the stage a concrete
  // size equal to the canvas so drag deltas translate 1:1 into canvas pixels.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: canvas.width,
    height: canvas.height,
    top: 0,
    left: 0,
    right: canvas.width,
    bottom: canvas.height,
    x: 0,
    y: 0,
    toJSON: () => "",
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Layout editor drag: snap-then-clamp", () => {
  it("keeps a dragged item fully inside the canvas even when snapping would push it out of bounds", async () => {
    mockAuth();
    renderLayoutEditor();
    const placement = await screen.findByText("New text");
    const placementEl = placement.closest(".layout-placement")!;

    // Drag far past the bottom-right edge. Both axes overshoot by an amount
    // that is already a multiple of 10, so snapping is a no-op here — the
    // bug this guards against is clamp running *before* snap, which would
    // round the already-clamped edge position (1815, 925 — neither a
    // multiple of 10, since width/height are not multiples of 10) back out
    // of bounds to (1820, 930).
    dragBy(placementEl, 5000, 5000);

    const style = (placementEl as HTMLElement).style;
    expect(parseFloat(style.left)).toBeCloseTo(pctOfWidth(1815), 5);
    expect(parseFloat(style.top)).toBeCloseTo(pctOfHeight(925), 5);
    // Size is untouched by a plain move.
    expect(parseFloat(style.width)).toBeCloseTo(pctOfWidth(105), 5);
    expect(parseFloat(style.height)).toBeCloseTo(pctOfHeight(155), 5);

    // Explicitly assert the invariant the fix restores: the item's right and
    // bottom edges never exceed the canvas.
    expect(parseFloat(style.left) + parseFloat(style.width)).toBeLessThanOrEqual(
      100.000001,
    );
    expect(parseFloat(style.top) + parseFloat(style.height)).toBeLessThanOrEqual(
      100.000001,
    );
  });

  it("still snaps to the nearest 10px grid away from the canvas edges", async () => {
    mockAuth();
    renderLayoutEditor();
    const placement = await screen.findByText("New text");
    const placementEl = placement.closest(".layout-placement")!;

    // 100 + 23 -> snaps to 120; 100 + 27 -> snaps to 130. Neither clamps.
    dragBy(placementEl, 23, 27);

    const style = (placementEl as HTMLElement).style;
    expect(parseFloat(style.left)).toBeCloseTo(pctOfWidth(120), 5);
    expect(parseFloat(style.top)).toBeCloseTo(pctOfHeight(130), 5);
  });

  it("moves by the raw unsnapped delta (still clamped) when snapping is disabled", async () => {
    mockAuth();
    renderLayoutEditor();
    const placement = await screen.findByText("New text");
    const placementEl = placement.closest(".layout-placement")!;

    fireEvent.click(screen.getByRole("checkbox", { name: "Snap" }));

    // Same delta as the snapping test, but now expect the exact unrounded
    // position: 100 + 23 = 123, 100 + 27 = 127.
    dragBy(placementEl, 23, 27);

    const style = (placementEl as HTMLElement).style;
    expect(parseFloat(style.left)).toBeCloseTo(pctOfWidth(123), 5);
    expect(parseFloat(style.top)).toBeCloseTo(pctOfHeight(127), 5);
  });
});