// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { LayoutSummary } from "../api/types";
import {
  filterAndSortLayouts,
  formatLayoutUpdatedAt,
  layoutPublicationLabel,
  layoutPublicationState,
} from "./LayoutsPage";

const layout = (
  values: Partial<LayoutSummary> & Pick<LayoutSummary, "id" | "name">,
): LayoutSummary => ({
  id: values.id,
  name: values.name,
  description: "",
  orientation: "landscape",
  canvasWidth: 1920,
  canvasHeight: 1080,
  draftRevision: 1,
  createdAt: "2026-07-01T12:00:00Z",
  updatedAt: "2026-07-01T12:00:00Z",
  ...values,
});

describe("layout library", () => {
  it("searches names, descriptions, dimensions, and status", () => {
    const items = [
      layout({ id: "welcome", name: "Welcome board" }),
      layout({
        id: "lunch",
        name: "Daily information",
        description: "Cafeteria lunch and library notices",
      }),
      layout({
        id: "portrait",
        name: "Hallway schedule",
        orientation: "portrait",
        canvasWidth: 1080,
        canvasHeight: 1920,
        publishedRevision: 2,
        draftRevision: 3,
      }),
    ];

    expect(
      filterAndSortLayouts(items, "library", "all", "all", "name"),
    ).toEqual([items[1]]);
    expect(
      filterAndSortLayouts(items, "1080x1920", "all", "all", "name"),
    ).toEqual([items[2]]);
    expect(
      filterAndSortLayouts(items, "unpublished changes", "all", "all", "name"),
    ).toEqual([items[2]]);
  });

  it("filters by orientation and publication state", () => {
    const items = [
      layout({ id: "draft", name: "Draft" }),
      layout({
        id: "published",
        name: "Published",
        publishedRevision: 2,
        draftRevision: 2,
      }),
      layout({
        id: "changes",
        name: "Changes",
        orientation: "portrait",
        canvasWidth: 1080,
        canvasHeight: 1920,
        publishedRevision: 2,
        draftRevision: 3,
      }),
    ];

    expect(filterAndSortLayouts(items, "", "portrait", "all", "name")).toEqual([
      items[2],
    ]);
    expect(filterAndSortLayouts(items, "", "all", "published", "name")).toEqual(
      [items[1]],
    );
    expect(filterAndSortLayouts(items, "", "all", "draft", "name")).toEqual([
      items[0],
    ]);
  });

  it("sorts by updates and publication date with name fallbacks", () => {
    const items = [
      layout({
        id: "alpha",
        name: "Alpha",
        updatedAt: "2026-07-02T12:00:00Z",
        publishedAt: "2026-07-01T12:00:00Z",
      }),
      layout({
        id: "beta",
        name: "Beta",
        updatedAt: "2026-07-03T12:00:00Z",
        publishedAt: "2026-07-04T12:00:00Z",
      }),
      layout({
        id: "charlie",
        name: "Charlie",
        updatedAt: "2026-07-01T12:00:00Z",
      }),
    ];

    expect(
      filterAndSortLayouts(items, "", "all", "all", "updated").map(
        (item) => item.id,
      ),
    ).toEqual(["beta", "alpha", "charlie"]);
    expect(
      filterAndSortLayouts(items, "", "all", "all", "published").map(
        (item) => item.id,
      ),
    ).toEqual(["beta", "alpha", "charlie"]);
  });

  it("describes publication state and useful relative update times", () => {
    const draft = layout({ id: "draft", name: "Draft" });
    const changes = layout({
      id: "changes",
      name: "Changes",
      publishedRevision: 2,
      draftRevision: 3,
    });
    const published = layout({
      id: "published",
      name: "Published",
      publishedRevision: 2,
      draftRevision: 2,
    });

    expect(layoutPublicationState(draft)).toBe("draft");
    expect(layoutPublicationState(changes)).toBe("changes");
    expect(layoutPublicationState(published)).toBe("published");
    expect(layoutPublicationLabel(changes)).toBe("Unpublished changes");
    expect(layoutPublicationLabel(published)).toBe("Published r2");

    const now = Date.parse("2026-07-26T16:00:00Z");
    expect(formatLayoutUpdatedAt("2026-07-26T15:59:30Z", now)).toBe(
      "Updated just now",
    );
    expect(formatLayoutUpdatedAt("2026-07-26T14:00:00Z", now)).toBe(
      "Updated 2 hours ago",
    );
    expect(formatLayoutUpdatedAt("not-a-date", now)).toBe(
      "Update time unavailable",
    );
  });
});
