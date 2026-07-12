import { describe, expect, it } from "vitest";
import { canDeployPlayerUpdates, playerUpdateStateLabel } from "./SettingsPage";

describe("Player Updates settings", () => {
  it("treats TV approval as a waiting state rather than a failure", () => {
    expect(playerUpdateStateLabel("waiting_for_user")).toContain(
      "approval required on TV",
    );
  });

  it("restricts deployment mutations to owners and administrators", () => {
    expect(canDeployPlayerUpdates("owner")).toBe(true);
    expect(canDeployPlayerUpdates("administrator")).toBe(true);
    expect(canDeployPlayerUpdates("editor")).toBe(false);
    expect(canDeployPlayerUpdates("viewer")).toBe(false);
  });
});
