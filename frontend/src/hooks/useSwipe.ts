import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import type { RefObject } from "react";
import { reducedMotion } from "./useExitTransition";

const COMMIT_PX = 96;
const FLICK_PX_PER_MS = 0.6;
const LOCK_PX = 10;
const BACK_MS = 200;
/** Space between the panels of a carousel face (the same number is in styles.css, .qb-panel). */
export const CAROUSEL_GAP = 14;

interface Options {
  /** which ways the row may be swiped; a way not listed is left to the page (scrolling, the browser's back gesture) */
  directions: ("left" | "right")[];
  onSwipe: (dir: "left" | "right") => void;
  enabled?: boolean;
  /**
   * The face is a strip of panels (the neighbours sit beside the one in view, see QueueBar): the face follows the finger up to one panel,
   * and a committed swipe carries it the rest of the way before `onSwipe` runs, so the next panel is what stays in view.
   */
  carousel?: boolean;
}

/**
 * Swipe a row sideways on a touch screen (guide section 20). The row's face (`[data-swipe-face]`, else the row) follows the finger; past 96 px
 * (or a quick flick) the action fires and the row springs back in 200 ms, otherwise it just springs back. Vertical movement wins
 * when the first move is mostly vertical, so scrolling never triggers it. Only touch and pen: a mouse never swipes.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, { directions, onSwipe, enabled = true, carousel = false }: Options): void {
  const key = directions.join();
  const cb = useRef(onSwipe);
  cb.current = onSwipe;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let busy = false; // a carousel is still carrying its panel over
    let s: { x: number; y: number; t: number; id: number; locked: boolean | null; dx: number; face: HTMLElement; lastX: number; lastT: number; v: number } | null = null;
    const face = () => (el.querySelector("[data-swipe-face]") as HTMLElement | null) ?? el;
    const reveal = (dx: number) => { el.setAttribute("data-swipe", dx > 0 ? "right" : dx < 0 ? "left" : ""); };

    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || s || busy) return;
      s = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, locked: null, dx: 0, face: face(), lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    };
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (s.locked === null) {
        if (Math.hypot(dx, dy) < LOCK_PX) return;
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2 && directions.includes(dx > 0 ? "right" : "left");
        s.locked = horizontal;
        if (horizontal) { s.face.style.transition = "none"; el.setAttribute("data-swiping", "true"); }
      }
      if (!s.locked) return;
      const reach = carousel ? s.face.offsetWidth + CAROUSEL_GAP : Infinity;
      const allowed = directions.includes(dx > 0 ? "right" : "left") ? Math.max(-reach, Math.min(reach, dx)) : 0;
      const dt = e.timeStamp - s.lastT;
      if (dt > 0) s.v = (e.clientX - s.lastX) / dt;
      s.lastX = e.clientX; s.lastT = e.timeStamp; s.dx = allowed;
      s.face.style.transform = `translateX(${allowed}px)`;
      reveal(allowed);
    };
    const end = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const d = s;
      s = null;
      if (!d.locked) return;
      const dir = d.dx > 0 ? "right" : "left";
      const commit = e.type === "pointerup" && (Math.abs(d.dx) >= COMMIT_PX || (Math.abs(d.v) >= FLICK_PX_PER_MS && Math.abs(d.dx) > 24 && (d.v > 0) === (d.dx > 0)));
      const settle = () => { d.face.style.transition = ""; d.face.style.transform = ""; el.removeAttribute("data-swiping"); el.removeAttribute("data-swipe"); };
      if (commit && carousel) {
        const swallowTap = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener("click", swallowTap, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", swallowTap, true), 50);
        const arrive = () => { flushSync(() => cb.current(dir)); settle(); busy = false; }; // the new state and the reset land in one paint: the panel that arrived is now the one in view
        if (reducedMotion()) { arrive(); return; }
        busy = true;
        d.face.style.transition = `transform ${BACK_MS}ms var(--ease-out)`;
        d.face.style.transform = `translateX(${(dir === "left" ? -1 : 1) * (d.face.offsetWidth + CAROUSEL_GAP)}px)`;
        setTimeout(arrive, BACK_MS);
        return;
      }
      if (commit) cb.current(dir);
      if (reducedMotion()) { settle(); return; }
      d.face.style.transition = `transform ${BACK_MS}ms var(--ease-out)`;
      d.face.style.transform = "translateX(0)";
      setTimeout(settle, BACK_MS + 20);
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener("click", swallow, { capture: true, once: true }); // the tap that ends a swipe is not a tap
      setTimeout(() => el.removeEventListener("click", swallow, true), 50);
    };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, enabled, key, carousel]);
}
