import { normalizeServerUrl } from "./server-url";

export interface CacheIdentity {
  installationId: string;
  screenId: string;
  normalizedServerUrl: string;
}

export function makeCacheIdentity(
  serverUrl: string,
  installationId: string | null | undefined,
  screenId: string | null | undefined,
): CacheIdentity | null {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized.ok || !normalized.url || !installationId || !screenId) {
    return null;
  }
  return { installationId, screenId, normalizedServerUrl: normalized.url };
}

export function cacheIdentityMatches(
  identity: CacheIdentity,
  value: Partial<CacheIdentity> | null | undefined,
): boolean {
  return (
    value?.installationId === identity.installationId &&
    value?.screenId === identity.screenId &&
    value?.normalizedServerUrl === identity.normalizedServerUrl
  );
}
