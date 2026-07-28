/**
 * Identifier hygiene for anything the player reports upward.
 *
 * The server models playback identifiers (`currentItemId`, `currentPlaylistId`,
 * `currentScheduleId`, `activeTakeoverId`, ...) as UUIDs, and its heartbeat
 * decoder rejects the whole payload when one of them is not a UUID. A single
 * synthetic renderer key used to cost the player every lifecycle field in the
 * same message — including `playerVersionCode` and `lastHealthyPlaybackAt`,
 * which is what settles a self-update deployment. So the player validates
 * before sending: a UUID-typed field carries a real UUID or nothing at all.
 *
 * Renderer item keys are a local concern. The renderer needs a stable key for
 * every presented item, including a directly assigned Layout that has no
 * playlist item behind it, so those keys are minted here and translated back
 * to the real UUID at the API boundary rather than leaking as-is.
 */

import { logger } from "./log";

const log = logger("identifiers");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefix of the synthetic key used for a directly assigned or scheduled Layout. */
const LAYOUT_ITEM_PREFIX = "layout-";

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** The renderer key for a Layout presented as a single fullscreen item. */
export function layoutItemKey(layoutId: string): string {
  return `${LAYOUT_ITEM_PREFIX}${layoutId}`;
}

/** The Layout UUID inside a renderer key, or null when the key is not one. */
export function layoutIdFromItemKey(key: string): string | null {
  if (!key.startsWith(LAYOUT_ITEM_PREFIX)) return null;
  const layoutId = key.slice(LAYOUT_ITEM_PREFIX.length);
  return isUuid(layoutId) ? layoutId : null;
}

/**
 * A UUID-typed heartbeat field. Invalid optional identifiers are dropped, never
 * substituted: a fabricated UUID would be a false playback claim, and keeping a
 * malformed one would cost the rest of the heartbeat.
 */
export function uuidHeartbeatField(
  field: string,
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (isUuid(value)) return value;
  log.debug("heartbeat identifier omitted: not a UUID", { field, value });
  return undefined;
}

/**
 * The UUID for `currentItemId` given the renderer's item key. Playlist items
 * already carry their manifest UUID. A Layout key is translated back to the
 * Layout UUID it was minted from, which is the content genuinely on screen.
 * Anything else is omitted.
 */
export function heartbeatItemId(
  rendererItemKey: string | null | undefined,
): string | undefined {
  if (!rendererItemKey) return undefined;
  if (isUuid(rendererItemKey)) return rendererItemKey;
  const layoutId = layoutIdFromItemKey(rendererItemKey);
  if (layoutId) return layoutId;
  log.debug("heartbeat currentItemId omitted: renderer key is not a UUID", {
    rendererItemKey,
  });
  return undefined;
}
