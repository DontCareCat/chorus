import { useEffect, useRef, useState } from "react";
import { KEYBOARD_MIN, keyboardFit } from "../lib/keyboard-fit";

export type Layout = "phone" | "compact" | "desktop";

// Same rules as design/Chorus Design System.md section 11.
// A touch screen (a coarse pointer without hover) of any size gets the phone interface: sheets, long press, swipes, no hover-only controls.
const PHONE = "(max-width: 700px), (max-height: 520px), (orientation: portrait) and (max-width: 1100px), (pointer: coarse) and (hover: none)";
const COMPACT = "(max-width: 1300px), (max-height: 760px)";

export function layoutFor(matches: (query: string) => boolean): Layout {
  if (matches(PHONE)) return "phone";
  if (matches(COMPACT)) return "compact";
  return "desktop";
}

/** True while a text field has focus: the on-screen keyboard is probably open and shrinks the viewport, which must not flip the layout. */
export function typing(el: Element | null = document.activeElement): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || (tag === "INPUT" && !/^(button|checkbox|radio|submit|reset|range|file|color)$/i.test((el as HTMLInputElement).type)) || (el as HTMLElement).isContentEditable === true;
}

const current = (): Layout => layoutFor((q) => window.matchMedia?.(q).matches ?? false);

/** Which screen class the page is on: a phone (or a tablet held upright), a tablet / small laptop, or a desktop. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const lists = [PHONE, COMPACT].map((q) => window.matchMedia(q));
    // Opening the keyboard on a tablet drops the height under 520 px; swapping the layout then would remount the open dialog and close the keyboard.
    const on = () => { if (!typing()) setLayout(current()); };
    const after = () => setLayout(current());
    lists.forEach((l) => l.addEventListener("change", on));
    document.addEventListener("focusout", after);
    document.documentElement.dataset.layout = layout;
    return () => { lists.forEach((l) => l.removeEventListener("change", on)); document.removeEventListener("focusout", after); };
  }, [layout]);
  return layout;
}


/** Narrowest window that still has room for the full menu in the top bar. */
export const INLINE_NAV_MIN = 720;

/** True while the window is wide enough for the top menu to show in full (a tablet keeps its touch layout but not the burger). */
export function useInlineNav(): boolean {
  const query = `(min-width: ${INLINE_NAV_MIN}px)`;
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const on = () => setWide(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, [query]);
  return wide;
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
      // What can really be seen (browser bars, a system navigation bar): the screen is never taller than that, even where 100dvh is (see .shell[data-route="game"])
      if (vv.scale <= 1.01) root.style.setProperty("--vv-fit", `${vv.height}px`);
      else root.style.removeProperty("--vv-fit");
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
    window.addEventListener("orientationchange", apply);
    const poll = window.setInterval(apply, 1000); // browsers do not always report a bar sliding in or out: never stay wrong for long
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("orientationchange", apply);
      root.style.removeProperty("--vv-fit");
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      root.classList.remove("kb-open");
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-top");
    };
  }, [active]);
}

export interface GameArrangement {
  /** Two columns (the player and the question on the left, the lyrics on the right) instead of one. */
  columns: boolean;
  /** A short screen (under 600 px high): the player bar gives way first. */
  short: boolean;
  /** Typing with the on-screen keyboard open. */
  keyboard: boolean;
  /** Two columns on a screen 520 px high or less (a phone on its side, a tablet with the keyboard up) */
  land: boolean;
  /** What can be seen right now (the visible viewport), in px. */
  visibleHeight: number;
  visibleWidth: number;
}

/** The arrangement the game page takes, from the shape of the viewport (not from `data-layout`): see the YouTube layouts spec. */
export function arrangementFor(width: number, visibleHeight: number, keyboard: boolean, fullHeight = visibleHeight): GameArrangement {
  const h = keyboard ? fullHeight : visibleHeight; // with the keyboard open the shape is that of the whole screen: the keyboard does not turn a phone sideways
  const landscapePhone = width > h && h <= 520;
  const wide = width >= 900 && width / h >= 1.2;
  return { columns: landscapePhone || wide, land: landscapePhone, short: h < 600, keyboard, visibleHeight, visibleWidth: width };
}

/** Watches the viewport, the keyboard and the focus; re-reads on a timer too, because keyboards do not always say when they move. */
export function useGameArrangement(active: boolean): GameArrangement {
  const calm = useRef({ height: 0, width: 0 }); // the visible height while no keyboard is up (this screen's own)
  const read = (): GameArrangement => {
    const vv = window.visualViewport;
    const visible = Math.round(vv && vv.scale <= 1.01 ? vv.height : window.innerHeight);
    const width = Math.round(window.innerWidth);
    if (calm.current.width !== width) calm.current = { height: 0, width }; // turned round (or resized): the old height means nothing
    // a keyboard is up when the screen really shrank under a focused field; a field that merely has focus (a hardware keyboard, iOS ignoring focus()) is not one
    const shrunk = calm.current.height > 0 && calm.current.height - visible > KEYBOARD_MIN;
    const open = document.documentElement.classList.contains("kb-open") || (typing() && shrunk);
    if (!open || calm.current.height === 0) calm.current.height = visible;
    return arrangementFor(width, visible, open, calm.current.height);
  };
  const [a, setA] = useState<GameArrangement>(read);
  useEffect(() => {
    if (!active) return;
    const update = () => setA((old) => { const n = read(); return old.columns === n.columns && old.land === n.land && old.short === n.short && old.keyboard === n.keyboard && old.visibleHeight === n.visibleHeight && old.visibleWidth === n.visibleWidth ? old : n; });
    const vv = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    vv?.addEventListener("resize", update);
    const poll = window.setInterval(update, 500);
    update();
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      vv?.removeEventListener("resize", update);
    };
  }, [active]);
  return a;
}
