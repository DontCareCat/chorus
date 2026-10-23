import { useCallback, useEffect, useLayoutEffect, useState } from "react";

const ACTIVE = '[aria-pressed="true"], [aria-current="page"], [aria-selected="true"]';

/**
 * The sliding thumb of a radio-like group (design guide section 16). Put `className="thumbs"` and the returned ref on the group;
 * the chosen child (aria-pressed / aria-current / aria-selected) is measured and the group's ::before follows it through the
 * CSS variables --thumb-x/y/w/h/r. The first measurement happens without a transition (data-thumb="still"), later ones glide.
 * Re-measured after every render, when the group or its font changes size, and on window resize.
 */
export function useThumb<T extends HTMLElement = HTMLDivElement>(): (node: T | null) => void {
  const [el, setEl] = useState<T | null>(null); // a callback ref: a group that appears later (a language row) is picked up too
  const measure = useCallback(() => {
    if (!el) return;
    const active = Array.from(el.children).find((c) => c.matches(ACTIVE)) as HTMLElement | undefined;
    if (!active) { el.dataset.thumb = "none"; return; }
    el.style.setProperty("--thumb-x", `${active.offsetLeft}px`);
    el.style.setProperty("--thumb-y", `${active.offsetTop}px`);
    el.style.setProperty("--thumb-w", `${active.offsetWidth}px`);
    el.style.setProperty("--thumb-h", `${active.offsetHeight}px`);
    el.style.setProperty("--thumb-r", getComputedStyle(active).borderTopLeftRadius);
    if (el.dataset.thumb !== "glide") el.dataset.thumb = "still";
  }, [el]);

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
