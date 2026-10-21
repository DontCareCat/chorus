export interface Fit {
  /** The on-screen keyboard (or something else) covers the bottom of the page. */
  open: boolean;
  /** Where the visible area starts and how tall it is, in layout pixels (only meaningful when `open`). */
  top: number;
  height: number;
}

/** A shrunken visual viewport smaller than this is the browser's own bars moving, not a keyboard. */
export const KEYBOARD_MIN = 120;

/**
 * Android Chrome (and iOS) leave the page at its full height when the keyboard opens and only shrink the *visual*
 * viewport, then pan it to the focused field: the top of the screen (the question) ends up above the visible area.
 * `innerHeight` is the layout viewport, `height` / `offsetTop` / `scale` are the visual viewport's. A pinch zoom also
 * shrinks the visual viewport, so a scale other than 1 is never taken for a keyboard.
 */
export function keyboardFit(innerHeight: number, vv: { height: number; offsetTop: number; scale: number }): Fit {
  const open = vv.scale <= 1.01 && innerHeight - vv.height > KEYBOARD_MIN;
  return { open, top: Math.max(0, vv.offsetTop), height: Math.max(0, vv.height) };
}
