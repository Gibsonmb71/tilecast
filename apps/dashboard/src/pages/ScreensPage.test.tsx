// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Screen, User } from "../api/types";
import {
  canManageScreens,
  reliabilityCapabilityWarning,
  ScreenListContent,
  StatusLabel,
} from "./ScreensPage";

const user = (role: User["role"]): User => ({
  id: "user",
  name: "Test User",
  username: "test",
  role,
  active: true,
  createdAt: new Date().toISOString(),
});

afterEach(cleanup);

describe("screen management", () => {
  it("restricts pairing and credential management by role", () => {
    expect(canManageScreens(user("owner"))).toBe(true);
    expect(canManageScreens(user("administrator"))).toBe(true);
    expect(canManageScreens(user("editor"))).toBe(false);
    expect(canManageScreens(user("viewer"))).toBe(false);
  });

  it("shows a useful empty state and pairing action to administrators", () => {
    render(
      <MemoryRouter>
        <ScreenListContent screens={[]} loading={false} canManage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: "No screens paired" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Pair your first screen" }),
    ).toHaveAttribute("href", "/screens/pair");
  });

  it("explains restrictions in the viewer empty state", () => {
    render(
      <MemoryRouter>
        <ScreenListContent screens={[]} loading={false} canManage={false} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("link", { name: "Pair your first screen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("An Owner or Administrator can approve new screens."),
    ).toBeInTheDocument();
  });

  it("renders status with text rather than color alone", () => {
    render(<StatusLabel status="revoked" />);
    expect(screen.getByText("Pairing revoked")).toBeInTheDocument();
  });

  it("renders live device status and accessible screen links", () => {
    const item: Screen = {
      id: "screen-1",
      name: "Lobby",
      description: "",
      location: "Main entrance",
      platform: "android-tv",
      deviceManufacturer: "Google",
      deviceModel: "ADT-3",
      androidVersion: "14",
      playerVersion: "0.2.0",
      screenWidth: 1920,
      screenHeight: 1080,
      density: 2,
      locale: "en-US",
      timezone: "UTC",
      enabled: true,
      pairedAt: new Date().toISOString(),
      lastContactAt: new Date().toISOString(),
      status: "online",
      hasActiveCredential: true,
    };
    render(
      <MemoryRouter>
        <ScreenListContent screens={[item]} loading={false} canManage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /Lobby/ })).toHaveAttribute(
      "href",
      "/screens/screen-1",
    );
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("does not confuse requested Managed Kiosk with effective capability", () => {
    expect(
      reliabilityCapabilityWarning({
        configuredMode: "managed_kiosk",
        effectiveMode: "standard",
        powerAssist: {
          deviceSleep: "untested",
          tvStandby: "untested",
          deviceWake: "untested",
          tvWake: "untested",
          inputSelection: "untested",
          tilecastStartup: "untested",
        },
      }),
    ).toContain("not confirmed");
  });
});
