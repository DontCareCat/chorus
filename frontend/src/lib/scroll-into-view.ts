export interface ScrollBox {
  /** top of the tapped song row and bottom of its opened play options, in viewport coordinates */
  itemTop: number;
  panelBottom: number;
  /** the part of the viewport that is usable (below the top bar, above the browser bars / keyboard) */
  viewTop: number;
  viewBottom: number;
  margin?: number;
}

/**
 * How far to scroll (positive = down) so the opened play options are in view. When the whole block (row + options) fits, scroll
 * only as much as needed to show its bottom; when it does not fit, the top has priority: the row's top goes to the top edge.
 */
export function scrollTarget({ itemTop, panelBottom, viewTop, viewBottom, margin = 12 }: ScrollBox): number {
  const top = viewTop + margin;
  const bottom = viewBottom - margin;
  if (panelBottom - itemTop > bottom - top) return Math.round(itemTop - top); // too tall: top first
  if (panelBottom > bottom) return Math.round(panelBottom - bottom); // fits: reveal the bottom
  if (itemTop < top) return Math.round(itemTop - top); // the row is cut off at the top: bring it down
  return 0;
}

/** Ease-out cubic: fast start, soft landing. */
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;

let running: { cancel: () => void } | null = null;

/**
 * Scroll the window by `dy` pixels over `ms`, frame by frame. (`scrollBy({ behavior: "smooth" })` is left to the browser, and a phone's
 * web view may jump at once; a scroll we draw ourselves always animates.) A newer call takes over from a running one.
 * `reduced` (the person asked for no motion) scrolls at once.
 */
export function animateScrollBy(dy: number, { ms = 320, reduced = false }: { ms?: number; reduced?: boolean } = {}): void {
  running?.cancel();
  running = null;
  if (dy === 0) return;
  if (reduced || ms <= 0) { window.scrollBy(0, dy); return; }
  const from = window.scrollY;
  const start = performance.now();
  let frame = 0;
  let last = 0;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const y = Math.round(from + dy * easeOut(t));
    window.scrollBy(0, y - (from + last));
    last = y - from;
    if (t < 1) frame = requestAnimationFrame(step);
    else running = null;
  };
  frame = requestAnimationFrame(step);
  running = { cancel: () => cancelAnimationFrame(frame) };
}
