/** Ease-out: fast at first, settling softly, never past the target (the lyric window must not overshoot and come back). */
export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Milliseconds a move of `distance` px takes: short hops stay quick, a long jump does not take forever. */
export const scrollDuration = (distance: number): number => Math.round(Math.min(420, Math.max(220, 180 + Math.abs(distance) * 0.35)));

/** Where the scroll is `elapsed` ms into a move from `from` to `to`. */
export const scrollPosition = (from: number, to: number, elapsed: number): number =>
  from + (to - from) * easeOutCubic(elapsed / scrollDuration(to - from));

/**
 * Scroll `el` to `top` in one eased move. A new call takes over from wherever the last one had got to (no jump); the returned function
 * stops the move (the reader touched the list). `instant` skips the animation (reduced motion, first placement).
 */
export function scrollSmoothly(el: HTMLElement, top: number, instant: boolean): () => void {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const to = Math.min(max, Math.max(0, Math.round(top)));
  const from = el.scrollTop;
  if (instant || Math.abs(to - from) < 2) { el.scrollTop = to; return () => undefined; }
  let id = 0;
  const start = performance.now();
  const step = (now: number) => {
    const elapsed = now - start;
    el.scrollTop = scrollPosition(from, to, elapsed);
    if (elapsed < scrollDuration(to - from)) id = requestAnimationFrame(step);
    else el.scrollTop = to;
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
