import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a separator above this item. */
  separated?: boolean;
};

export type ContextMenuAnchor<Target> = {
  target: Target;
  x: number;
  y: number;
};

/**
 * Tracks which row was right-clicked and where its menu belongs. Right-click and the visible
 * trigger share one opener so both routes produce the same menu at a sensible position.
 */
export function useContextMenu<Target>() {
  const [anchor, setAnchor] = useState<ContextMenuAnchor<Target>>();
  const close = useCallback(() => setAnchor(undefined), []);
  const open = useCallback(
    (event: ReactMouseEvent<HTMLElement>, target: Target) => {
      event.preventDefault();
      event.stopPropagation();
      // Keyboard activation of a trigger button reports no pointer position, so the menu
      // anchors under the control instead of the top-left corner of the viewport.
      const keyboard = event.type === "click" && event.detail === 0;
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor({
        target,
        x: keyboard ? rect.left : event.clientX,
        y: keyboard ? rect.bottom : event.clientY,
      });
    },
    [],
  );
  return { anchor, open, close };
}

export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
}: {
  x: number;
  y: number;
  label: string;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: x, top: y, ready: false });

  // Measure after the first paint so a menu opened near an edge folds back on screen
  // rather than being clipped.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const gap = 8;
    setPlacement({
      left: Math.max(gap, Math.min(x, window.innerWidth - width - gap)),
      top: Math.max(gap, Math.min(y, window.innerHeight - height - gap)),
      ready: true,
    });
  }, [x, y]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    // The menu is pinned to viewport coordinates, so anything that moves the page under it
    // dismisses it instead of leaving it stranded.
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const moveFocus = (delta: number, absolute?: "first" | "last") => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    if (!buttons.length) return;
    if (absolute) {
      (absolute === "first"
        ? buttons[0]
        : buttons[buttons.length - 1]
      )?.focus();
      return;
    }
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    buttons[(current + delta + buttons.length) % buttons.length]?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0, "first");
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(0, "last");
    }
  };

  return createPortal(
    <div className="context-menu-layer">
      <div
        className="context-menu__backdrop"
        aria-hidden="true"
        onPointerDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="context-menu"
        role="menu"
        aria-label={label}
        style={{
          left: placement.left,
          top: placement.top,
          visibility: placement.ready ? undefined : "hidden",
        }}
        onKeyDown={handleKeyDown}
      >
        {items.map((item) => (
          <Fragment key={item.label}>
            {item.separated && <hr className="context-menu__separator" />}
            <button
              type="button"
              role="menuitem"
              className={`context-menu__item${item.danger ? " context-menu__item--danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {item.icon && (
                <span className="context-menu__icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span>{item.label}</span>
            </button>
          </Fragment>
        ))}
      </div>
    </div>,
    document.body,
  );
}
