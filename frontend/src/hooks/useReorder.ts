import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { flushSync } from "react-dom";
import { edgeScroll, moveItem, shifts, targetIndex } from "../lib/reorder";
import { reducedMotion } from "./useExitTransition";

const HOLD_MS = 350;
const HOLD_SLOP = 8;
const SETTLE_MS = 180;

interface Options {
  /** the ids in list order; each row of the list carries `data-reorder-id` */
  ids: readonly number[];
  enabled: boolean;
  /** "grip": drag a `[data-grip]` handle with the mouse (and Alt+arrows); "press": hold a row for 350 ms, then drag (touch) */
  mode: "grip" | "press";
  onReorder: (ids: number[]) => void;
}

interface Drag { li: HTMLElement; from: number; startY: number; startScroll: number; rects: { top: number; height: number }[]; clientY: number; target: number; raf: number; pointerId: number }

/**
 * Reordering by dragging (guide section 16): the dragged row follows the pointer with no easing and the rows between slide out of its way
 * (200 ms); on release it settles into its slot (180 ms). Esc cancels. The list scrolls when the pointer nears an edge.
 * Returns a status line for a screen-reader live region (also set by Alt+Up / Alt+Down on a focused handle).
 */
export function useReorder(list: RefObject<HTMLElement | null>, { ids, enabled, mode, onReorder }: Options): string {
  const [status, setStatus] = useState("");
  const latest = useRef({ ids, onReorder });
  latest.current = { ids, onReorder };

  useEffect(() => {
    const root = list.current;
    if (!root || !enabled) return;
    const rows = () => Array.from(root.children) as HTMLElement[];
    let drag: Drag | null = null;
    let hold: { timer: number; x: number; y: number; li: HTMLElement; id: number } | null = null;
    let swallow = false;

    const apply = (d: Drag) => {
      const items = rows();
      const h = d.rects[d.from]!.height;
      const dy = d.clientY - d.startY + (window.scrollY - d.startScroll);
      d.li.style.transform = `translateY(${dy}px)`;
      const center = d.rects[d.from]!.top + dy + h / 2;
      d.target = targetIndex(d.rects.map((r) => r.top + r.height / 2), d.from, center);
      shifts(items.length, d.from, d.target, h).forEach((s, j) => { if (j !== d.from) items[j]!.style.transform = s ? `translateY(${s}px)` : ""; });
    };
    const clean = () => {
      root.removeAttribute("data-reordering");
      for (const li of rows()) { li.style.transform = ""; li.style.transition = ""; li.removeAttribute("data-dragging"); }
    };
    const loop = () => {
      if (!drag) return;
      const v = edgeScroll(drag.clientY, 0, window.innerHeight);
      if (v) { window.scrollBy(0, v); apply(drag); }
      drag.raf = requestAnimationFrame(loop);
    };
    const blockScroll = (e: TouchEvent) => { if (drag && e.cancelable) e.preventDefault(); };

    const begin = (li: HTMLElement, clientY: number, pointerId: number) => {
      const items = rows();
      const from = items.indexOf(li);
      if (from < 0) return;
      const rects = items.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top + window.scrollY, height: r.height }; });
      drag = { li, from, startY: clientY, startScroll: window.scrollY, rects, clientY, target: from, raf: 0, pointerId };
      root.setAttribute("data-reordering", "true");
      li.setAttribute("data-dragging", "true");
      li.style.transition = "none";
      drag.raf = requestAnimationFrame(loop);
      document.addEventListener("touchmove", blockScroll, { passive: false });
      setStatus("");
    };

    const finish = (commit: boolean) => {
      const d = drag;
      if (!d) return;
      drag = null;
      cancelAnimationFrame(d.raf);
      document.removeEventListener("touchmove", blockScroll);
      const to = commit ? d.target : d.from;
      const h = d.rects[d.from]!.height;
      const finalTop = to > d.from ? d.rects[to]!.top + d.rects[to]!.height - h : d.rects[to]!.top;
      const done = () => {
        if (to !== d.from) {
          const order = moveItem(latest.current.ids, d.from, to);
          flushSync(() => latest.current.onReorder(order)); // the new order is in the DOM before the transforms go: no flash
          setStatus(`${en_moved(to + 1, order.length)}`);
        }
        clean();
      };
      if (reducedMotion()) { done(); return; }
      d.li.style.transition = `transform ${SETTLE_MS}ms var(--ease-standard)`;
      d.li.style.transform = `translateY(${finalTop - d.rects[d.from]!.top}px)`;
      setTimeout(done, SETTLE_MS + 10);
    };

    const onMove = (e: PointerEvent) => {
      if (hold) {
        if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) { clearTimeout(hold.timer); hold = null; }
        return;
      }
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.clientY = e.clientY;
      apply(drag);
    };
    const onUp = (e: PointerEvent) => {
      if (hold) { clearTimeout(hold.timer); hold = null; }
      if (drag && e.pointerId === drag.pointerId) { swallow = true; setTimeout(() => { swallow = false; }, 0); finish(e.type === "pointerup"); }
    };
    const onKey = (e: KeyboardEvent) => { if (drag && e.key === "Escape") { e.preventDefault(); finish(false); } };
    const onDown = (e: PointerEvent) => {
      if (drag || (e.pointerType === "mouse" && e.button !== 0)) return;
      const t = e.target as HTMLElement;
      const li = t.closest("[data-reorder-id]") as HTMLElement | null;
      if (!li || li.parentElement !== root) return;
      if (mode === "grip") {
        const grip = t.closest("[data-grip]");
        if (!grip) return;
        e.preventDefault();
        (grip as HTMLElement).setPointerCapture?.(e.pointerId);
        begin(li, e.clientY, e.pointerId);
      } else if (e.pointerType !== "mouse" && !t.closest("button, a, input")) {
        const id = e.pointerId;
        hold = { x: e.clientX, y: e.clientY, li, id, timer: window.setTimeout(() => { hold = null; navigator.vibrate?.(10); begin(li, e.clientY, id); }, HOLD_MS) };
      }
    };
    const onClick = (e: MouseEvent) => { if (swallow) { e.stopPropagation(); e.preventDefault(); } };
    const onContext = (e: Event) => { if (hold || drag) e.preventDefault(); };
    const onGripKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const li = (e.target as HTMLElement).closest("[data-reorder-id]") as HTMLElement | null;
      if (!li || !(e.target as HTMLElement).closest("[data-grip]")) return;
      const from = rows().indexOf(li);
      const to = from + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= latest.current.ids.length) return;
      e.preventDefault();
      const order = moveItem(latest.current.ids, from, to);
      latest.current.onReorder(order);
      setStatus(en_moved(to + 1, order.length));
      requestAnimationFrame(() => root.querySelector<HTMLElement>(`[data-reorder-id="${order[to]}"] [data-grip]`)?.focus());
    };

    root.addEventListener("pointerdown", onDown);
    root.addEventListener("click", onClick, true);
    root.addEventListener("contextmenu", onContext);
    root.addEventListener("keydown", onGripKey);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    document.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("contextmenu", onContext);
      root.removeEventListener("keydown", onGripKey);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("touchmove", blockScroll);
      if (hold) clearTimeout(hold.timer);
      if (drag) { cancelAnimationFrame(drag.raf); drag = null; }
      clean();
    };
  }, [list, enabled, mode]);

  return status;
}

const en_moved = (position: number, total: number) => `Moved to position ${position} of ${total}`;
