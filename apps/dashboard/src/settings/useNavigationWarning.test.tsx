import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNavigationWarning } from "./useNavigationWarning";

function Harness() {
  useNavigationWarning(true, "/settings", "Leave with unsaved changes?");
  return (
    <div>
      <a href="/outside">Same tab</a>
      <a href="/outside" target="_blank">
        New tab
      </a>
      <a href="/download" download>
        Download
      </a>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useNavigationWarning", () => {
  it("does not warn when the current page will remain open", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByRole } = render(<Harness />);

    getByRole("link", { name: "New tab" }).click();
    getByRole("link", { name: "Download" }).click();

    const modifiedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    getByRole("link", { name: "Same tab" }).dispatchEvent(modifiedClick);

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("still warns before same-tab navigation away", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { getByRole } = render(<Harness />);
    const link = getByRole("link", { name: "Same tab" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });

    const allowed = link.dispatchEvent(click);

    expect(confirmSpy).toHaveBeenCalledWith("Leave with unsaved changes?");
    expect(allowed).toBe(false);
  });
});
