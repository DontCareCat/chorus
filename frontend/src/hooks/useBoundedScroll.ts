import { useEffect } from "react";
import type { RefObject } from "react";

/**
 * A list that scrolls inside its own box: it gets the room between its top and `limitTop()` (the top of the action row fixed at the bottom of
 * the screen) and shows a fade at the top and/or bottom only while content is cut off in that direction (`--fade-t` / `--fade-b` on the element).
 * `key` changes when the content does (a new card).
 */
export function useBoundedScroll(ref: RefObject<HTMLElement | null>, limitTop: () => number | null, key: unknown, min = 112, fade = 28) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const limit = limitTop();
      if (limit !== null) el.style.maxHeight = `${Math.max(min, Math.floor(limit - el.getBoundingClientRect().top - 12))}px`;
      const top = el.scrollTop > 1, bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      el.style.setProperty("--fade-t", top ? `${fade}px` : "0px");
      el.style.setProperty("--fade-b", bottom ? `${fade}px` : "0px");
      el.dataset.cut = top || bottom ? "true" : "false";
    };
    fit();
    el.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", fit);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
    const later = setTimeout(fit, 300); // the fonts and the translation settle after the first paint
    return () => { el.removeEventListener("scroll", fit); window.removeEventListener("resize", fit); vv?.removeEventListener("resize", fit); ro?.disconnect(); clearTimeout(later); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
