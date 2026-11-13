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

/** Per-frame share of the remaining distance that {@link followSmoothly} covers: fast at first, settling softly, never past the target. */
export const FOLLOW_EASE = 0.22;

/** One frame of the follow: closes a share of the gap, and lands exactly when it is under a pixel. */
export const followStep = (current: number, target: number): number => (Math.abs(target - current) < 1 ? target : current + (target - current) * FOLLOW_EASE);

/**
 * Keep `el` scrolled to a target that is itself moving (the lines grow and shrink while they change size): every frame the target is asked
 * for again, and the scroll closes part of the gap, so there is no overshoot and no second settling move. Runs for `ms` and then lands on
 * the target. Returns a function that stops it (the reader touched the list). `instant` just places the scroll.
 */
export function followSmoothly(el: HTMLElement, target: () => number, ms: number, instant: boolean): () => void {
  const clamp = (v: number) => Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, Math.round(v)));
  if (instant) { el.scrollTop = clamp(target()); return () => undefined; }
  let id = 0;
  const start = performance.now();
  let dir = 0; // the way the first move went: the lines above shrink while the target settles, which must not make the scroll turn back
  const step = (now: number) => {
    const to = clamp(target());
    const from = el.scrollTop;
    if (now - start >= ms) { el.scrollTop = dir !== 0 && (to - from) * dir < 0 ? from : to; return; }
    const next = followStep(from, to);
    if (dir === 0 && next !== from) dir = Math.sign(next - from);
    if (dir === 0 || (next - from) * dir >= 0) el.scrollTop = next;
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}

/** The progress (0..1) of a CSS cubic-bezier(x1, y1, x2, y2) transition `t` (0..1) of the way through its time: the same curve the browser runs. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s * s + s ** 3;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 24; i++) { s = (lo + hi) / 2; if (at(x1, x2, s) < t) lo = s; else hi = s; }
  return at(y1, y2, s);
}

/** The curve of `--ease-standard`, the one the lines' size transition uses. */
export const easeStandard = (t: number): number => cubicBezier(0.4, 0, 0.2, 1, t);

/**
 * Scroll `el` towards a target that is itself moving, on the SAME clock and curve as the CSS transition that moves it (the lines change size
 * over `ms` with --ease-standard): the scroll position is `from` blended with the target as it is right now, so the pan and the size change
 * start together, run together and end together (no pan first and resize after, or the other way round). Lands exactly on the target.
 * Returns a function that stops it. `instant` just places the scroll.
 */
export function followInSync(el: HTMLElement, target: () => number, ms: number, instant: boolean): () => void {
  const clamp = (v: number) => Math.min(Math.max(0, el.scrollHeight - el.clientHeight), Math.max(0, Math.round(v)));
  if (instant) { el.scrollTop = clamp(target()); return () => undefined; }
  const from = el.scrollTop;
  const start = performance.now();
  let id = 0;
  const step = (now: number) => {
    const t = (now - start) / ms;
    const to = clamp(target());
    if (t >= 1) { el.scrollTop = to; return; }
    el.scrollTop = from + (to - from) * easeStandard(t);
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => cancelAnimationFrame(id);
}
