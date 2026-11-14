import { useLayoutEffect, useRef } from "react";

const FADE = 48;

/**
 * The scrim behind the tab bar: its own layer, below the queue bar and the tabs and above the page. It starts at the bottom of the screen and is one smooth
 * gradient (clear at its top, the page's colour at the screen edge: no solid band). Without the queue bar it covers the tabs plus 48px; with it, it starts 48px
 * above the queue bar's top edge.
 * The real heights of the tab bar and the queue bar are measured (they change with safe areas and the queue bar's message lines).
 */
export function NavFade() {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fade = el.current;
    if (!fade) return;
    const shell = fade.parentElement!;
    const place = () => {
      const nav = shell.querySelector<HTMLElement>(".main-nav");
      const bar = shell.querySelector<HTMLElement>(".queue-bar:not([data-state='closing'])");
      const navH = nav?.offsetHeight ?? 64;
      if (!bar) { fade.style.setProperty("--fade-h", `${navH + FADE}px`); return; }
      const barBottom = parseFloat(getComputedStyle(bar).bottom) || 0; // from the bottom of the screen
      const barH = bar.offsetHeight;
      fade.style.setProperty("--fade-h", `${Math.max(navH + FADE, barBottom + barH + FADE)}px`);
    };
    place();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    const watch = () => { ro?.disconnect(); shell.querySelectorAll(".main-nav, .queue-bar").forEach((n) => ro?.observe(n)); place(); };
    watch();
    const mo = new MutationObserver(watch); // the queue bar comes and goes
    mo.observe(shell, { childList: true });
    window.addEventListener("resize", place);
    return () => { ro?.disconnect(); mo.disconnect(); window.removeEventListener("resize", place); };
  }, []);
  return <div className="nav-fade" ref={el} aria-hidden="true" />;
}
