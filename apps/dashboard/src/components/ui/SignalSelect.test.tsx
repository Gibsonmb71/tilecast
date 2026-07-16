// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./SignalSelect";

describe("Signal Select", () => {
  it("opens a Signal listbox and emits native select changes", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    function Example() {
      const [value, setValue] = useState("one");
      return (
        <Select
          aria-label="Example"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            changed(event.target.value);
          }}
        >
          <option value="one">One</option>
          <option value="two">Two</option>
        </Select>
      );
    }
    render(<Example />);
    await user.click(screen.getByRole("combobox", { name: "Example" }));
    await user.click(screen.getByRole("option", { name: "Two" }));
    expect(changed).toHaveBeenCalledWith("two");
    expect(
      screen.getByRole("combobox", { name: "Example" }).textContent,
    ).toContain("Two");
  });

  it("supports grouped options and keyboard selection", async () => {
    const changed = vi.fn();
    render(
      <Select aria-label="Target" defaultValue="playlist" onChange={changed}>
        <optgroup label="Content">
          <option value="playlist">Playlist</option>
          <option value="layout">Layout</option>
        </optgroup>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Target" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = await screen.findByRole("option", { name: "Playlist" });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("option", { name: "Layout" }), {
      key: "Enter",
    });
    expect(changed).toHaveBeenCalled();
    expect(trigger.textContent).toContain("Layout");
  });
});
