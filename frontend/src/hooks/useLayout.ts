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


/** On the game screen the page itself never scrolls: its parts are sized to fit (see .game-lock in styles.css). */
export function useGameLock(active: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("game-lock", active);
    return () => root.classList.remove("game-lock");
  }, [active]);
}
