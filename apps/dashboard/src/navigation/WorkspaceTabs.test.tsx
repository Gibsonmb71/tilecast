// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceTabs,
  contentTabs,
  presentationTabs,
  tabMatchesPath,
} from "./WorkspaceTabs";

afterEach(cleanup);

function tabs(pathname: string, set = contentTabs) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <WorkspaceTabs label="Content library" tabs={set} />
    </MemoryRouter>,
  );
}

describe("tabMatchesPath", () => {
  it("matches the tab's own route", () => {
    expect(tabMatchesPath("/widgets", "/widgets")).toBe(true);
  });

  it("matches routes nested beneath the tab", () => {
    expect(tabMatchesPath("/widgets", "/widgets/new/menu")).toBe(true);
  });

  // Without the separator check, /assets would claim /assets-archive.
  it("does not match a path that merely shares a prefix", () => {
    expect(tabMatchesPath("/assets", "/assets-archive")).toBe(false);
  });

  it("does not match an unrelated route", () => {
    expect(tabMatchesPath("/widgets", "/layouts")).toBe(false);
  });
});

describe("WorkspaceTabs", () => {
  it("links every facet of the workspace", () => {
    tabs("/assets");

    const media = screen.getByRole("link", { name: "Media" });
    expect(media).toHaveAttribute("href", "/assets");
    expect(media.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("link", { name: "Widgets" })).toHaveAttribute(
      "href",
      "/widgets",
    );
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute(
      "href",
      "/data-sources",
    );
  });

  it("marks exactly one facet current", () => {
    tabs("/data-sources");

    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Media" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // An editor route is still inside its facet, so the tab must not go dark while editing.
  it("keeps the facet current on a nested editor route", () => {
    tabs("/widgets/new/menu");

    expect(screen.getByRole("link", { name: "Widgets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders the Presentations facets", () => {
    tabs("/layouts", presentationTabs);

    expect(screen.getByRole("link", { name: "Playlists" })).toHaveAttribute(
      "href",
      "/playlists",
    );
    expect(screen.getByRole("link", { name: "Layouts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
