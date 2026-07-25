// Return paths arrive from the URL, so a value that is not an in-app route must never become a
// navigation target. Only absolute paths within the app are honored; a protocol-relative value
// such as "//example.com" is rejected along with anything carrying a scheme.
export function inAppPath(value: string | null | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}

// withParam adds or replaces one query parameter on an in-app path, preserving the rest.
export function withParam(path: string, key: string, value: string) {
  const [base = "", query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(key, value);
  return `${base}?${params.toString()}`;
}
