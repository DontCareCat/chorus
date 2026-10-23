import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const ACTIVE = '[aria-pressed="true"], [aria-current="page"], [aria-selected="true"]';
type Rect = Record<"x" | "y" | "w" | "h" | "r", string>;
const remembered = new Map<string, Rect>(); // where a keyed thumb was last seen, for groups that are re-created when the page changes

/**
 * The sliding thumb of a radio-like group (design guide section 16). Put `className="thumbs"` and the returned ref on the group;
 * the chosen child (aria-pressed / aria-current / aria-selected) is measured and the group's ::before follows it through the
 * CSS variables --thumb-x/y/w/h/r. The first measurement happens without a transition (data-thumb="still"), later ones glide.
 * Re-measured after every render, when the group or its font changes size, and on window resize.
 * With a `key`, a group that is mounted anew (the library tabs live on two pages) starts where the previous one ended and glides from there.
 */
export function useThumb<T extends HTMLElement = HTMLDivElement>(key?: string): (node: T | null) => void {
  const [el, setEl] = useState<T | null>(null); // a callback ref: a group that appears later (a language row) is picked up too
  const measure = useCallback(() => {
    if (!el) return;
    const active = Array.from(el.children).find((c) => c.matches(ACTIVE)) as HTMLElement | undefined;
    if (!active) { el.dataset.thumb = "none"; return; }
    const set = (r: Rect) => (Object.keys(r) as (keyof Rect)[]).forEach((k) => el.style.setProperty(`--thumb-${k}`, r[k]));
    const now: Rect = { x: `${active.offsetLeft}px`, y: `${active.offsetTop}px`, w: `${active.offsetWidth}px`, h: `${active.offsetHeight}px`, r: getComputedStyle(active).borderTopLeftRadius };
    const from = key && !el.dataset.thumb ? remembered.get(key) : undefined;
    if (from && Object.keys(now).some((k) => now[k as keyof Rect] !== from[k as keyof Rect]) && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      set(from);
      el.dataset.thumb = "still"; // jump to the old place without a transition ...
      void el.getBoundingClientRect(); // ... and render it once, or there is nothing to glide from
      el.dataset.thumb = "glide";
    }
    set(now);
    if (key) remembered.set(key, now);
    if (el.dataset.thumb !== "glide") el.dataset.thumb = "still";
  }, [el, key]);

  useLayoutEffect(measure); // after every render: the chosen option or the labels may have changed
  useEffect(() => {
    if (!el) return;
    const glide = requestAnimationFrame(() => requestAnimationFrame(() => { if (el.dataset.thumb === "still") el.dataset.thumb = "glide"; }));
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    Array.from(el.children).forEach((c) => ro?.observe(c));
    window.addEventListener("resize", measure);
    void document.fonts?.ready.then(measure);
    return () => { cancelAnimationFrame(glide); ro?.disconnect(); window.removeEventListener("resize", measure); };
  }, [el, measure]);
  return setEl;
}
