import { describe, expect, it } from "vitest";
import { canDeployPlayerUpdates, playerUpdateStateLabel } from "./SettingsPage";

describe("Player Updates settings", () => {
  it("treats TV approval as a waiting state rather than a failure", () => {
    const label = playerUpdateStateLabel("waiting_for_user");
    expect(label).toContain("approve the installer on the TV");
    expect(label).toContain("not a failure");
  });

  it("restricts deployment mutations to owners and administrators", () => {
    expect(canDeployPlayerUpdates("owner")).toBe(true);
    expect(canDeployPlayerUpdates("administrator")).toBe(true);
    expect(canDeployPlayerUpdates("editor")).toBe(false);
    expect(canDeployPlayerUpdates("viewer")).toBe(false);
  });
});
