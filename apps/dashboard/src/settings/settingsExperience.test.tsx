// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingDefinition } from "../api/types";
import { SettingControl } from "./SettingControl";
import { dependencyState } from "./settingDependencies";
import { enumLabel, groupsFor } from "./settingDisplay";
import { sectionFromPath, settingsNavigation } from "./settingsNavigation";

afterEach(cleanup);
const definition = (
  partial: Partial<SettingDefinition>,
): SettingDefinition => ({
  key: "test.setting",
  category: "playback",
  type: "string",
  title: "Test setting",
  default: "",
  scope: "organization",
  sensitive: false,
  restartRequired: false,
  immediate: false,
  futureOnly: false,
  ...partial,
});

describe("settings presentation", () => {
  it("uses grouped URL-backed navigation", () => {
    expect(settingsNavigation.map((group) => group.label)).toEqual([
      "Organization",
      "Content and playback",
      "Player management",
      "Operations",
      "Personal",
    ]);
    expect(sectionFromPath("/settings/player/reliability")).toBe("reliability");
    expect(sectionFromPath("/settings")).toBe("general");
  });

  it("renders booleans as an accessible switch", () => {
    const change = vi.fn();
    render(
      <SettingControl
        definition={definition({ type: "bool", title: "Launch after boot" })}
        value={false}
        onChange={change}
      />,
    );
    const control = screen.getByRole("switch", { name: "Launch after boot" });
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(change).toHaveBeenCalledWith(true);
  });

  it("keeps enum storage values while showing human labels", () => {
    expect(enumLabel("managed_kiosk")).toBe("Managed Kiosk");
    const change = vi.fn();
    render(
      <SettingControl
        definition={definition({
          type: "enum",
          title: "Cookie policy",
          allowed: ["first_party", "first_and_third_party"],
        })}
        value="first_party"
        onChange={change}
      />,
    );
    const control = screen.getByRole("combobox", { name: "Cookie policy" });
    expect(control).toHaveTextContent("First-party cookies");
    fireEvent.click(control);
    fireEvent.click(
      screen.getByRole("option", {
        name: "First- and third-party cookies",
      }),
    );
    expect(change).toHaveBeenCalledWith("first_and_third_party");
  });

  it("edits weekdays without exposing numeric ISO values", () => {
    const change = vi.fn();
    render(
      <SettingControl
        definition={definition({ type: "weekday_list", title: "Active days" })}
        value={[1, 2, 3, 4, 5]}
        onChange={change}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sat" }));
    expect(change).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
    expect(screen.queryByDisplayValue("1, 2, 3, 4, 5")).not.toBeInTheDocument();
  });

  it("converts byte display units without changing stored bytes", () => {
    const change = vi.fn();
    render(
      <SettingControl
        definition={definition({
          key: "player.cache.max_bytes",
          type: "int64",
          title: "Maximum cache size",
          min: 1024 ** 2,
          max: 1024 ** 4,
        })}
        value={8 * 1024 ** 3}
        onChange={change}
      />,
    );
    expect(
      screen.getByRole("spinbutton", { name: "Maximum cache size" }),
    ).toHaveValue(8);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Maximum cache size" }),
      { target: { value: "12" } },
    );
    expect(change).toHaveBeenCalledWith(12 * 1024 ** 3);
  });

  it("presents second-backed durations in readable units", () => {
    const change = vi.fn();
    render(
      <SettingControl
        definition={definition({
          key: "player.sync.manifest_seconds",
          type: "int",
          title: "Manifest reconciliation interval",
          min: 60,
          max: 86400,
        })}
        value={300}
        onChange={change}
      />,
    );
    expect(
      screen.getByRole("spinbutton", {
        name: "Manifest reconciliation interval",
      }),
    ).toHaveValue(5);
    expect(
      screen.getByRole("combobox", {
        name: "Manifest reconciliation interval unit",
      }),
    ).toHaveTextContent("minutes");
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "Manifest reconciliation interval",
      }),
      { target: { value: "10" } },
    );
    expect(change).toHaveBeenCalledWith(600);
  });

  it("centralizes dependencies and meaningful subsections", () => {
    expect(
      dependencyState("power.active_hours_days", {
        "power.active_hours_enabled": false,
      }),
    ).toMatchObject({ disabled: true });
    const groups = groupsFor("playback", [
      definition({
        key: "player.cache.max_bytes",
        type: "int64",
        title: "Maximum cache size",
      }),
    ]);
    expect(groups.at(0)?.title).toBe("Storage and delivery");
  });
});
