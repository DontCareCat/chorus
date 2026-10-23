import { describe, expect, it } from "vitest";
import { add, advance, back, finished, moveToTop, next, removeAt, reorderUpcoming, setAllUpcoming, setItem, shared, shuffled, start, upcoming } from "./queue";

const D = { difficulty: "progressive", mode: "choice" } as const;
const ids = (q: { items: { songId: number }[] }) => q.items.map((i) => i.songId);

describe("queue", () => {
  it("goes one song back, but not before the first", () => {
    let q = advance(advance(start([1, 2, 3], D, null)));
    expect(next(back(q))?.songId).toBe(2);
    q = back(back(q));
    expect(next(q)?.songId).toBe(1);
    expect(back(q)).toBe(q);
    expect(next(back(advance(advance(advance(start([1, 2], D, null)))))) ?.songId).toBe(2); // out of a finished queue too
  });
  it("adds songs once each, in order", () => {
    const q = add(add(start([1, 2], D, null), [3, 2, 3], D), [], D);
    expect(ids(q)).toEqual([1, 2, 3]);
  });
  it("shuffles without repeats and replays with the same seed", () => {
    const a = shuffled([1, 2, 3, 4, 5, 6, 7, 8], 42), b = shuffled([1, 2, 3, 4, 5, 6, 7, 8], 42);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shuffled([1, 2, 3, 4, 5, 6, 7, 8], 43)).not.toEqual(a);
  });
  it("advances to the end and says it is finished", () => {
    let q = start([1, 2], D, null);
    expect(next(q)?.songId).toBe(1);
    q = advance(advance(q));
    expect(next(q)).toBeNull();
    expect(finished(q)).toBe(true);
    expect(advance(q).cursor).toBe(2);
  });
  it("removing keeps the cursor on the same upcoming song", () => {
    let q = advance(start([1, 2, 3, 4], D, null)); // next is 2
    expect(ids(removeAt(q, 0))).toEqual([2, 3, 4]);
    expect(next(removeAt(q, 0))?.songId).toBe(2);
    expect(next(removeAt(q, 2))?.songId).toBe(2);
    expect(ids(removeAt(q, 9))).toEqual([1, 2, 3, 4]);
  });
  it("reorders only the waiting songs", () => {
    const q = advance(start([1, 2, 3, 4], D, null));
    expect(ids(reorderUpcoming(q, [4, 2, 3]))).toEqual([1, 4, 2, 3]);
    expect(ids(reorderUpcoming(q, [4, 2]))).toEqual([1, 2, 3, 4]); // not a permutation: ignored
    expect(ids(moveToTop(q, 4))).toEqual([1, 4, 2, 3]);
  });
  it("sets one song or all waiting songs, and reports a shared value", () => {
    let q = advance(start([1, 2, 3], D, null));
    expect(shared(q, "difficulty")).toBe("progressive");
    q = setItem(q, 3, { difficulty: "hard" });
    expect(shared(q, "difficulty")).toBeNull();
    q = setAllUpcoming(q, { difficulty: "easy", mode: "typing" });
    expect(upcoming(q).map((i) => `${i.difficulty}/${i.mode}`)).toEqual(["easy/typing", "easy/typing"]);
    expect(q.items[0]!.difficulty).toBe("progressive"); // the one already started keeps its own
    expect(shared(q, "mode")).toBe("typing");
  });
});
