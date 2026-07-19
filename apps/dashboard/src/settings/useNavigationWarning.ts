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
      if (
        link &&
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
