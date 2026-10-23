import { useRef } from "react";
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
 */
export function useLongPress({ onLongPress, ms = LONG_PRESS_MS, touchOnly = true }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return {
    handlers: {
      onPointerDown: (e: ReactPointerEvent) => {
        if (touchOnly && e.pointerType === "mouse") return;
        fired.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => { fired.current = true; timer.current = null; onLongPress(); }, ms);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: { preventDefault: () => void }) => { if (fired.current || timer.current !== null) e.preventDefault(); }, // no browser menu on a held touch
    },
    /** true once after a long press: the click that ends it must not also toggle the row */
    consumeClick: () => { const f = fired.current; fired.current = false; return f; },
  };
}
