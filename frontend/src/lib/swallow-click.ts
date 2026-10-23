/**
 * Closing a layer (menu, dropdown, bubble) by tapping outside must do nothing else: the click that follows that tap would
 * otherwise reach whatever lies underneath (a song row, a link). Call this from the closing `pointerdown`; the next click
 * is stopped in the capture phase, and the guard removes itself after a moment if no click comes (a scroll or a drag).
 */
export function swallowNextClick(ms = 600): void {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); done(); };
  const timer = setTimeout(() => done(), ms);
  const done = () => { clearTimeout(timer); window.removeEventListener("click", stop, true); };
  window.addEventListener("click", stop, true);
}
