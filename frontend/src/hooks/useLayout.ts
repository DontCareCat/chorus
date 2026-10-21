import { useEffect, useState } from "react";
import { keyboardFit } from "../lib/keyboard-fit";

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


/** On the game screen the page itself never scrolls: its parts are sized to fit (see .game-lock in styles.css). */
export function useGameLock(active: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("game-lock", active);
    return () => root.classList.remove("game-lock");
  }, [active]);
}

/**
 * While the on-screen keyboard is open the game screen is pinned to the visible area (see lib/keyboard-fit.ts):
 * `.kb-open` + `--vv-h` / `--vv-top` on <html>, used by styles.css. Browsers that resize the page for the keyboard
 * (`interactive-widget=resizes-content` in index.html) never trigger it.
 */
export function useKeyboardFit(active: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const root = document.documentElement;
    const apply = () => {
      const fit = keyboardFit(window.innerHeight, vv);
      root.classList.toggle("kb-open", fit.open);
      if (fit.open) {
        root.style.setProperty("--vv-h", `${fit.height}px`);
        root.style.setProperty("--vv-top", `${fit.top}px`);
      }
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      root.classList.remove("kb-open");
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, [active]);
}
