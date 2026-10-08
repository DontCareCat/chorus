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
 * The game screen must be exactly as tall as what the person can see. CSS units (100vh, 100dvh, 100svh) are
 * interpreted differently by mobile browsers and versions (some count the area under the browser's bars), so the height
 * is measured: `window.innerHeight` is the visible page height in every browser, and it is re-read whenever the
 * window or the browser's bars change it. Published as `--app-h`; CSS falls back to 100svh without it.
 */
export function useAppHeight(active: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!active) {
      root.classList.remove("game-lock");
      root.style.removeProperty("--app-h");
      return;
    }
    root.classList.add("game-lock"); // the page itself never scrolls on the game screen: its parts fit
    const update = () => root.style.setProperty("--app-h", `${window.innerHeight}px`);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
      root.classList.remove("game-lock");
      root.style.removeProperty("--app-h");
    };
  }, [active]);
}
