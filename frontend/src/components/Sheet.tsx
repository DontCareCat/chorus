import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { reducedMotion } from "../hooks/useExitTransition";
import { en } from "../i18n/en";

export const SHEET_IN_MS = 280;
export const SHEET_OUT_MS = 220;
/** Past this share of its height, or this speed (px/ms), a released drag closes the sheet. */
export const DISMISS_SHARE = 0.3;
export const DISMISS_SPEED = 0.5;
const TAP_PX = 6;

/** Pure rule for a released drag: close it, or spring back. */
export function dragOutcome(dy: number, height: number, speed: number): "tap" | "close" | "back" {
  if (dy < TAP_PX) return "tap";
  return dy > height * DISMISS_SHARE || speed > DISMISS_SPEED ? "close" : "back";
}

export interface SheetApi {
  /** roll the sheet away, then call onClose */
  close: () => void;
}

interface Props {
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * A bottom sheet (design guide section 16): rolls up with the dimmed backdrop fading in, rolls away on Esc, on a tap on the
 * backdrop or on the handle, and follows the finger when the handle is held and dragged (past 30% of its height, or a flick,
 * it rolls away; otherwise it springs back). Nothing underneath is activated by the tap that closes it.
 */
export const Sheet = forwardRef<SheetApi, Props>(function Sheet({ onClose, label, className, children }, api) {
  const [state, setState] = useState<"enter" | "open" | "closing">("enter");
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; last: number; lastT: number; speed: number; moved: boolean } | null>(null);
  const done = useRef(onClose);
  done.current = onClose;

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setState((s) => (s === "enter" ? "open" : s))));
    return () => cancelAnimationFrame(id);
  }, []);
  const close = useCallback(() => setState("closing"), []);
  useImperativeHandle(api, () => ({ close }), [close]);
  useEffect(() => {
    if (state !== "closing") return;
    const t = setTimeout(() => done.current(), reducedMotion() ? 0 : SHEET_OUT_MS);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", key);
    document.documentElement.classList.add("dialog-open");
    return () => { document.removeEventListener("keydown", key); document.documentElement.classList.remove("dialog-open"); };
  }, [close]);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp, last: e.clientY, lastT: e.timeStamp, speed: 0, moved: false };
    panel.current?.setAttribute("data-dragging", "true");
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    const dy = Math.max(0, e.clientY - d.y);
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.speed = (e.clientY - d.last) / dt;
    d.last = e.clientY; d.lastT = e.timeStamp;
    if (dy >= TAP_PX) d.moved = true;
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    const el = panel.current;
    if (!d || !el) return;
    el.removeAttribute("data-dragging");
    const dy = Math.max(0, e.clientY - d.y);
    const outcome = d.moved ? dragOutcome(dy, el.offsetHeight, d.speed) : "tap";
    if (outcome === "back") {
      el.style.transition = "transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1)";
      el.style.transform = "";
      setTimeout(() => { el.style.transition = ""; }, 220);
    } else {
      if (outcome === "close") { el.style.transition = `transform ${SHEET_OUT_MS}ms ease-in`; el.style.transform = "translateY(100%)"; } // from where the finger left it
      close();
    }
  };

  return (
    <div className="sheet-scrim" data-state={state} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`sheet${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-label={label} ref={panel} data-state={state}>
        <button
          type="button" className="grab" aria-label={en.dialog.close}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; panel.current?.removeAttribute("data-dragging"); if (panel.current) panel.current.style.transform = ""; }}
        ><i aria-hidden="true" /></button>
        {children}
      </div>
    </div>
  );
});
