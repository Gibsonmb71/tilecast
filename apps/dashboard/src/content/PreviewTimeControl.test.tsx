// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewTimeControl } from "./PreviewTimeControl";

describe("PreviewTimeControl", () => {
  it("labels the preview mode button group", () => {
    render(
      <PreviewTimeControl
        value={{ mode: "live", value: "" }}
        onChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("group", { name: "Preview time" });
    expect(group).not.toBeNull();
    expect(screen.getByRole("button", { name: "Live" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "At a time" })).not.toBeNull();
  });
});
