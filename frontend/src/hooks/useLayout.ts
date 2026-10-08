import { useEffect, useState } from "react";

export type Layout = "phone" | "compact" | "desktop";

// Same rules as design/Chorus Design System.md section 11.
const PHONE = "(max-width: 700px), (max-height: 520px), (orientation: portrait) and (max-width: 1100px)";
const COMPACT = "(max-width: 1300px), (max-height: 760px)";

export function layoutFor(matches: (query: string) => boolean): Layout {
  if (matches(PHONE)) return "phone";
  if (matches(COMPACT)) return "compact";
  return "desktop";
}

const current = (): Layout => layoutFor((q) => window.matchMedia?.(q).matches ?? false);

/** Which screen class the page is on: a phone (or a tablet held upright), a tablet / small laptop, or a desktop. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const lists = [PHONE, COMPACT].map((q) => window.matchMedia(q));
    const on = () => setLayout(current());
    lists.forEach((l) => l.addEventListener("change", on));
    document.documentElement.dataset.layout = layout;
    return () => lists.forEach((l) => l.removeEventListener("change", on));
  }, [layout]);
  return layout;
}

/**
 * Mobile browsers show and hide their address and navigation bars while the page is open. `100vh` and fixed
 * positioning follow the LARGE viewport, so the bottom of the game screen (the player) ended up under the browser's
 * own bar. The visual viewport is what the person actually sees: its size is published as CSS variables that the
 * game screen uses, and it follows every change (bars sliding in or out, rotation, the on-screen keyboard).
 */
export function applyViewport(vv: { height: number; offsetTop: number }, root: HTMLElement): void {
  root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
  root.style.setProperty("--app-top", `${Math.round(vv.offsetTop)}px`);
}

export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // the CSS falls back to 100dvh
    const update = () => applyViewport(vv, document.documentElement);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
}
