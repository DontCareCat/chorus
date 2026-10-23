import { useEffect, useState } from "react";

export const reducedMotion = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Keeps a layer mounted while it animates away. `state` is "open" once it has been painted closed (so the CSS transition has a
 * starting point) and goes back to "closed" when `open` turns false; `mounted` stays true until the exit has finished.
 */
export function useExitTransition(open: boolean, ms: number): { mounted: boolean; state: "open" | "closed" } {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<"open" | "closed">("closed");
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setState("open")));
      return () => cancelAnimationFrame(id);
    }
    setState("closed");
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted, state };
}
