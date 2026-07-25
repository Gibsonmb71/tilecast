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
