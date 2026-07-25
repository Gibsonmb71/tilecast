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

// withParam adds or replaces one query parameter on an in-app path, preserving the rest.
export function withParam(path: string, key: string, value: string) {
  const fragmentIndex = path.indexOf("#");
  const beforeFragment =
    fragmentIndex === -1 ? path : path.slice(0, fragmentIndex);
  const fragment = fragmentIndex === -1 ? "" : path.slice(fragmentIndex);
  const queryIndex = beforeFragment.indexOf("?");
  const base =
    queryIndex === -1 ? beforeFragment : beforeFragment.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : beforeFragment.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${base}?${params.toString()}${fragment}`;
}
