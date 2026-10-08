import { useLayoutEffect, useRef } from "react";

/**
 * Shrinks the text of a fixed-height element until it fits (never below half its CSS size). The element keeps its
 * height whatever the sentence, so everything below it never moves. Re-fits when `content` changes and when resized
 * (not on every render: measuring forces a layout, and the game page renders ten times a second).
 */
export function useFitText<T extends HTMLElement>(content: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = ""; // back to the CSS size, then shrink as needed
      const base = parseFloat(getComputedStyle(el).fontSize);
      const min = Math.max(16, base * 0.5);
      let size = base;
      while (el.scrollHeight > el.clientHeight + 1 && size > min) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);
  return ref;
}
