// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldButton } from "./HoldButton";

/* jsdom has no frame loop, so drive the component's requestAnimationFrame off
   the fake timers along with the clock it reads. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) =>
    clearTimeout(handle),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fill = () =>
  document.querySelector(".hold-button__fill") as HTMLElement | null;

describe("hold to confirm", () => {
  it("fires only after the button has been held for the full duration", () => {
    const onHoldComplete = vi.fn();
    render(
      <HoldButton holdMs={3000} onHoldComplete={onHoldComplete}>
        Hold to activate takeover
      </HoldButton>,
    );
    const button = screen.getByRole("button", {
      name: /hold to activate takeover/i,
    });

    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(1500));
    expect(onHoldComplete).not.toHaveBeenCalled();
    // Halfway through, the fill reports halfway across (to the last frame).
    expect(
      Number(/scaleX\(([\d.]+)\)/.exec(fill()?.style.transform ?? "")?.[1]),
    ).toBeCloseTo(0.5, 1);

    act(() => vi.advanceTimersByTime(1600));
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
    // Nothing is left counting once it has fired.
    act(() => vi.advanceTimersByTime(3000));
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
    expect(fill()?.style.transform).toBe("scaleX(0)");
  });

  it("cancels and resets when the press ends early", () => {
    const onHoldComplete = vi.fn();
    render(
      <HoldButton holdMs={3000} onHoldComplete={onHoldComplete}>
        Hold to activate takeover
      </HoldButton>,
    );
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.pointerUp(button);
    act(() => vi.advanceTimersByTime(5000));

    expect(onHoldComplete).not.toHaveBeenCalled();
    expect(fill()?.style.transform).toBe("scaleX(0)");
  });

  it("cancels when the pointer leaves the button mid-hold", () => {
    const onHoldComplete = vi.fn();
    render(
      <HoldButton holdMs={3000} onHoldComplete={onHoldComplete}>
        Hold
      </HoldButton>,
    );
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(2500));
    fireEvent.pointerLeave(button);
    act(() => vi.advanceTimersByTime(5000));

    expect(onHoldComplete).not.toHaveBeenCalled();
  });

  it("ignores a secondary press and a disabled button", () => {
    const onHoldComplete = vi.fn();
    const { rerender } = render(
      <HoldButton holdMs={100} onHoldComplete={onHoldComplete}>
        Hold
      </HoldButton>,
    );
    const button = screen.getByRole("button");

    fireEvent.pointerDown(button, { button: 2 });
    act(() => vi.advanceTimersByTime(500));
    expect(onHoldComplete).not.toHaveBeenCalled();

    rerender(
      <HoldButton holdMs={100} onHoldComplete={onHoldComplete} disabled>
        Hold
      </HoldButton>,
    );
    fireEvent.pointerDown(button, { button: 0 });
    act(() => vi.advanceTimersByTime(500));
    expect(onHoldComplete).not.toHaveBeenCalled();
  });

  it("can be held from the keyboard, where key repeat does not restart it", () => {
    const onHoldComplete = vi.fn();
    render(
      <HoldButton
        holdMs={3000}
        onHoldComplete={onHoldComplete}
        holdingLabel="Keep holding…"
        hint="Hold for 3 seconds to take over every screen."
      >
        Hold to activate takeover
      </HoldButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveAccessibleDescription(
      "Hold for 3 seconds to take over every screen.",
    );

    fireEvent.keyDown(button, { key: " " });
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.keyDown(button, { key: " ", repeat: true });
    act(() => vi.advanceTimersByTime(1000));
    expect(button).toHaveTextContent("Keep holding…");
    expect(onHoldComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1100));
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("Hold to activate takeover");

    fireEvent.keyDown(button, { key: " " });
    fireEvent.keyUp(button, { key: " " });
    act(() => vi.advanceTimersByTime(5000));
    expect(onHoldComplete).toHaveBeenCalledTimes(1);
  });
});
