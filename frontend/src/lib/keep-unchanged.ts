/** `next` with every item that is the same as its counterpart (by id) in `prev` replaced by that very object, so React can skip the rows that did not change. */
export function keepUnchanged<T extends { id: number }>(prev: readonly T[], next: readonly T[]): T[] {
  if (prev.length === 0) return [...next];
  const old = new Map(prev.map((x) => [x.id, x]));
  return next.map((x) => {
    const o = old.get(x.id);
    return o !== undefined && JSON.stringify(o) === JSON.stringify(x) ? o : x;
  });
}
