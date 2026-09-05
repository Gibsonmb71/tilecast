import { useEffect } from "react";

export function useNavigationWarning(
  dirty: boolean,
  allowPrefix: string,
  message: string,
) {
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest("a");
      if (!link) return;

      // Opening a link in another browsing context does not discard the current
      // page, so warning here is both noisy and misleading. The same applies to
      // download links and modified clicks that open a new tab/window.
      if (
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;

      if (
        !link.getAttribute("href")?.startsWith(allowPrefix) &&
        !confirm(message)
      )
        event.preventDefault();
    };
    addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, allowPrefix, message]);
}
