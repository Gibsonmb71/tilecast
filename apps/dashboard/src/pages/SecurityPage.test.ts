import { describe, expect, it, vi } from "vitest";
import { copyRecoveryCodesToClipboard } from "./SecurityPage";

describe("recovery code clipboard handling", () => {
  it("copies every recovery code as separate lines", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      copyRecoveryCodesToClipboard(["alpha", "bravo"], { writeText }),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("alpha\nbravo");
  });

  it("reports clipboard failures instead of treating them as success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));

    await expect(
      copyRecoveryCodesToClipboard(["alpha"], { writeText }),
    ).resolves.toBe(false);
  });

  it("reports an unavailable Clipboard API", async () => {
    await expect(
      copyRecoveryCodesToClipboard(["alpha"], undefined),
    ).resolves.toBe(false);
  });
});
