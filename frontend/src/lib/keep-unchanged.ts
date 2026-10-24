/** `next` with every item that is the same as its counterpart (by id) in `prev` replaced by that very object, so React can skip the rows that did not change; when nothing changed, `prev` itself. */
export function keepUnchanged<T extends { id: number }>(prev: readonly T[], next: readonly T[]): T[] {
  if (prev.length === 0) return [...next];
  const old = new Map(prev.map((x) => [x.id, x]));
  const out = next.map((x) => {
    const o = old.get(x.id);
    return o !== undefined && JSON.stringify(o) === JSON.stringify(x) ? o : x;
  });
  // nothing changed at all: the very same array, so everything computed from the list (duplicates, filters, counts) is not computed again
  return out.length === prev.length && out.every((x, i) => x === prev[i]) ? (prev as T[]) : out;
}
