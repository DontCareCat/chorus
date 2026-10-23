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
