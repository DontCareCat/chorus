import { useLayoutEffect, useRef } from "react";

/**
 * Shrinks the text of a fixed-height element until it fits (never below half its CSS size). The element keeps its
 * height whatever the sentence, so everything below it never moves. Re-fits on every render and when resized.
 */
export function useFitText<T extends HTMLElement>() {
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
  });
  return ref;
}
