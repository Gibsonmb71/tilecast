import { describe, expect, it } from "vitest";
import { resolvePlaybackItemSettings } from "./player";

describe("authoritative playback defaults", () => {
  it("overrides authored media values only when the item delegates", () => {
    const item = {
      id: "item",
      assetId: "asset",
      assetType: "image",
      durationMs: 10_000,
      fitMode: "contain",
      transition: "none",
      audioEnabled: true,
      volume: 1,
      deliveryPolicy: "download",
      usePlayerDefaults: true,
    };
    expect(
      resolvePlaybackItemSettings(
        item,
        {
          defaultFitMode: "cover",
          defaultTransition: "fade",
          defaultAudioEnabled: false,
          defaultVolume: 0.25,
        },
        22_000,
      ),
    ).toMatchObject({
      durationMs: 22_000,
      fitMode: "cover",
      transition: "fade",
      audioEnabled: false,
      volume: 0.25,
    });
  });

  it("preserves authored values when delegation is disabled", () => {
    const item = {
      id: "item",
      assetId: "asset",
      assetType: "image",
      durationMs: 10_000,
      fitMode: "stretch",
      transition: "crossfade",
      audioEnabled: true,
      volume: 0.9,
      deliveryPolicy: "download",
      usePlayerDefaults: false,
    };
    expect(
      resolvePlaybackItemSettings(item, { defaultFitMode: "cover" }, 22_000),
    ).toMatchObject({
      durationMs: 10_000,
      fitMode: "stretch",
      transition: "crossfade",
      audioEnabled: true,
      volume: 0.9,
    });
  });
});
