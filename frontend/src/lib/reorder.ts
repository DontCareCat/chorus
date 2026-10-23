/** Pure rules of drag-to-reorder (guide section 16): where a dragged row lands and how far the others move out of its way. */

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it as T);
  return next;
}

/** The final index of the dragged row: how many of the OTHER rows have their middle above the dragged row's middle. */
export function targetIndex(mids: readonly number[], from: number, center: number): number {
  let n = 0;
  mids.forEach((m, i) => { if (i !== from && m < center) n++; });
  return n;
}

/** How far each row (not the dragged one) moves while `from` is held at `to`: up by the dragged height, down by it, or not at all. */
export function shifts(count: number, from: number, to: number, height: number): number[] {
  return Array.from({ length: count }, (_, j) => {
    if (j === from) return 0;
    if (from < to && j > from && j <= to) return -height;
    if (to < from && j >= to && j < from) return height;
    return 0;
  });
}

/** Scroll speed (px per frame) while the pointer is within `zone` of an edge of the visible area; 0 elsewhere. */
export function edgeScroll(y: number, top: number, bottom: number, zone = 60, max = 18): number {
  if (y < top + zone) return -Math.round(max * Math.min(1, (top + zone - y) / zone));
  if (y > bottom - zone) return Math.round(max * Math.min(1, (y - (bottom - zone)) / zone));
  return 0;
}
