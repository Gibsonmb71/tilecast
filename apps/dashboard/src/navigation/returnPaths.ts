// Return paths arrive from the URL, so a value that is not an in-app route must never become a
// navigation target. Only absolute paths within the app are honored; a protocol-relative value
// such as "//example.com" is rejected along with anything carrying a scheme.
export function inAppPath(value: string | null | undefined) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : null;
}

// Adds a query parameter to an in-app path that may already carry a query string
// or a hash, so a return path can report what happened while the author was away.
export function withParam(path: string, key: string, value: string) {
  const hashAt = path.indexOf("#");
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = base.indexOf("?");
  const params = new URLSearchParams(
    queryAt === -1 ? "" : base.slice(queryAt + 1),
  );
  params.set(key, value);
  const pathname = queryAt === -1 ? base : base.slice(0, queryAt);
  return `${pathname}?${params.toString()}${hash}`;
}
