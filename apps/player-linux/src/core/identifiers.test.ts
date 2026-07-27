import { describe, expect, it } from "vitest";
import {
  heartbeatItemId,
  isUuid,
  layoutIdFromItemKey,
  layoutItemKey,
  uuidHeartbeatField,
} from "./identifiers";

const LAYOUT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ITEM_ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("identifier hygiene", () => {
  it("accepts only canonical UUIDs", () => {
    expect(isUuid(ITEM_ID)).toBe(true);
    expect(isUuid(ITEM_ID.toUpperCase())).toBe(true);
    expect(isUuid(`layout-${LAYOUT_ID}`)).toBe(false);
    expect(isUuid("layout:item")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it("round-trips the synthetic Layout renderer key", () => {
    const key = layoutItemKey(LAYOUT_ID);
    expect(key).toBe(`layout-${LAYOUT_ID}`);
    expect(layoutIdFromItemKey(key)).toBe(LAYOUT_ID);
    expect(layoutIdFromItemKey("layout-not-a-uuid")).toBeNull();
    expect(layoutIdFromItemKey(ITEM_ID)).toBeNull();
  });

  it("reports the Layout UUID rather than the renderer key", () => {
    expect(heartbeatItemId(layoutItemKey(LAYOUT_ID))).toBe(LAYOUT_ID);
    expect(heartbeatItemId(ITEM_ID)).toBe(ITEM_ID);
  });

  it("omits renderer keys that carry no UUID", () => {
    expect(heartbeatItemId("layout-broken")).toBeUndefined();
    expect(heartbeatItemId("poster")).toBeUndefined();
    expect(heartbeatItemId(null)).toBeUndefined();
  });

  it("omits rather than fabricates UUID heartbeat fields", () => {
    expect(uuidHeartbeatField("currentPlaylistId", ITEM_ID)).toBe(ITEM_ID);
    expect(
      uuidHeartbeatField("currentPlaylistId", "playlist-1"),
    ).toBeUndefined();
    expect(uuidHeartbeatField("currentScheduleId", "")).toBeUndefined();
    expect(uuidHeartbeatField("activeEmergencyId", undefined)).toBeUndefined();
  });
});
