import { describe, expect, it } from "vitest";
import { droppedFiles } from "./dragDrop";

const file = (name: string) => new File(["data"], name, { type: "image/png" });

describe("droppedFiles", () => {
  it("returns files dropped from outside the page", () => {
    const files = [file("photo.png"), file("clip.png")];
    expect(droppedFiles({ types: ["Files"], files })).toEqual(files);
  });

  it("ignores drags of elements already on the page", () => {
    // Dragging an <img> in Chromium exposes the bitmap as a file alongside
    // the source URL; treating it as an upload duplicates the asset.
    expect(
      droppedFiles({
        types: ["text/uri-list", "text/html", "Files"],
        files: [file("thumbnail.png")],
      }),
    ).toEqual([]);
    expect(
      droppedFiles({
        types: ["text/html", "Files"],
        files: [file("thumbnail.png")],
      }),
    ).toEqual([]);
  });

  it("returns nothing for text-only drags", () => {
    expect(droppedFiles({ types: ["text/plain"], files: [] })).toEqual([]);
  });
});
