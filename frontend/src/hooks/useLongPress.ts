import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export const LONG_PRESS_MS = 450;
export const MOVE_TOLERANCE = 8;

interface Options {
  onLongPress: () => void;
  ms?: number;
  /** only touch / pen presses count; a mouse uses the checkbox */
  touchOnly?: boolean;
}

/**
 * Press and hold. Returns pointer handlers for an element; after a long press the click that follows the release is swallowed
 * (`consumeClick()` returns true once), and moving more than 8 px or scrolling cancels the press.
 *
 * The hold is only decided one frame after the timer: while the page is busy (a list page rendering on a slow phone) the timer can run
 * before the finger's queued moves and the scroll they started, and a flick would count as a long press.
 */
export function useLongPress({ onLongPress, ms = LONG_PRESS_MS, touchOnly = true }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const frame = useRef<number | null>(null);
  const done = useRef(onLongPress);
  done.current = onLongPress;
  // one function for the whole life of the row, so the scroll listener added on a press is the one removed
  const cancel = useCallback(function stop() {
    if (timer.current !== null) clearTimeout(timer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    timer.current = null;
    frame.current = null;
    start.current = null;
    document.removeEventListener("scroll", stop, true);
  }, []);
  const fire = useCallback(() => {
    if (start.current === null) return;
    cancel();
    fired.current = true;
    done.current();
  }, [cancel]);
  useEffect(() => cancel, [cancel]); // unmounted mid-press

  return {
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        if (touchOnly && e.pointerType === "mouse") return;
        cancel();
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        document.addEventListener("scroll", cancel, true); // any scroll, of the page or of a list inside it, ends the press
        timer.current = setTimeout(() => {
          timer.current = null;
          frame.current = requestAnimationFrame(() => { frame.current = null; fire(); }); // queued moves and scrolls get their turn first
        }, ms);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
      },
      onPointerUp: () => { if (frame.current !== null) fire(); else cancel(); }, // lifted while the hold was being decided: everything queued has arrived, so it was a hold
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: { preventDefault: () => void }) => { if (fired.current || timer.current !== null || frame.current !== null) e.preventDefault(); }, // no browser menu on a held touch
    },
    /** true once after a long press: the click that ends it must not also toggle the row */
    consumeClick: () => { const f = fired.current; fired.current = false; return f; },
  };
}
