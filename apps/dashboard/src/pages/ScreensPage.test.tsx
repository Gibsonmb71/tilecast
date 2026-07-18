// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Screen, User } from "../api/types";
import type { PairingRequest } from "../api/types";
import {
  canManageScreens,
  formatReportedStatus,
  reliabilityCapabilityWarning,
  pairingApprovalLabel,
  pairingApprovalPayload,
  resolveScreenDetail,
  ScreenListContent,
  StatusLabel,
  zeroTouchReadiness,
} from "./ScreensPage";

describe("reliability status display", () => {
  it("formats reported status values without rendering response objects", () => {
    expect(formatReportedStatus("needs_attention")).toBe("needs attention");
    expect(formatReportedStatus(" ")).toBe("Not reported");
    expect(formatReportedStatus(undefined)).toBe("Not reported");
    expect(formatReportedStatus({ id: "player-1", name: "Lobby" })).toBe(
      "Not reported",
    );
  });
});

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

  it("renders an unknown status instead of crashing on incomplete data", () => {
    render(<StatusLabel status={null as unknown as Screen["status"]} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("uses the dashboard record when detail data is incomplete", () => {
    const listed = {
      id: "screen-1",
      name: "Lobby",
      status: "online",
    } as Screen;
    const detail = {
      ...listed,
      name: "Lobby display",
      status: null as unknown as Screen["status"],
    };

    expect(resolveScreenDetail(detail, listed)).toMatchObject({
      name: "Lobby display",
      status: "online",
    });
    expect(resolveScreenDetail(undefined, listed)).toBe(listed);
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

  it("reports zero-touch readiness only after every safeguard is verified", () => {
    const powerAssist = {
      deviceSleep: "untested",
      tvStandby: "untested",
      deviceWake: "untested",
      tvWake: "untested",
      inputSelection: "untested",
      tilecastStartup: "untested",
    };
    expect(
      zeroTouchReadiness({
        commissioningState: "complete",
        accessibilityServiceState: "enabled",
        bootLaunchVerified: true,
        immersiveModeActive: true,
        keepScreenOn: true,
        cachedFallbackAvailable: true,
        updateReadiness: "ready",
        safeMode: false,
        powerAssist,
      }),
    ).toBe("Ready");
    expect(
      zeroTouchReadiness({
        commissioningState: "complete",
        accessibilityServiceState: "disabled",
        powerAssist,
      }),
    ).toBe("Partially ready");
    expect(
      zeroTouchReadiness({
        commissioningState: "complete",
        accessibilityServiceState: "unsupported",
        bootLaunchVerified: true,
        immersiveModeActive: true,
        keepScreenOn: true,
        cachedFallbackAvailable: false,
        updateReadiness: "ready",
        safeMode: false,
        powerAssist,
      }),
    ).toBe("Partially ready");
    expect(
      zeroTouchReadiness({
        commissioningState: "complete",
        accessibilityServiceState: "enabled",
        bootLaunchVerified: true,
        immersiveModeActive: true,
        keepScreenOn: true,
        cachedFallbackAvailable: false,
        updateReadiness: "ready",
        safeMode: false,
        powerAssist,
      }),
    ).toBe("Ready");
  });

  it("uses an explicit credential-replacement payload for known players", () => {
    const request: PairingRequest = {
      id: "pairing",
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      previouslyPaired: true,
      existingScreenId: "screen-1",
      existingScreenName: "Cafeteria Display",
      hasActiveCredential: true,
      credentialReplacementAuthorized: false,
      metadata: {
        playerInstallationId: "installation",
        platform: "android-tv",
        manufacturer: "Amazon",
        model: "Fire TV",
        androidVersion: "11",
        playerVersion: "0.10.1",
        screenWidth: 1920,
        screenHeight: 1080,
        density: 1.5,
        locale: "en-US",
        timezone: "America/New_York",
      },
    };
    expect(pairingApprovalLabel(request)).toBe("Repair and replace credential");
    expect(
      pairingApprovalPayload(request, {
        name: "Cafeteria Display",
        location: "",
        description: "",
      }),
    ).toEqual({
      name: "Cafeteria Display",
      location: "",
      description: "",
      replaceExistingCredential: true,
    });
  });
});
