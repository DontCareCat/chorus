import { describe, expect, it } from "vitest";
import { keepUnchanged } from "./keep-unchanged";

describe("keepUnchanged", () => {
  it("reuses the objects that did not change and takes the new ones", () => {
    const prev = [{ id: 1, n: "a" }, { id: 2, n: "b" }];
    const next = [{ id: 1, n: "a" }, { id: 2, n: "B" }, { id: 3, n: "c" }];
    const out = keepUnchanged(prev, next);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(next[1]);
    expect(out[2]).toBe(next[2]);
  });
  it("gives back the same array when nothing changed", () => {
    const prev = [{ id: 1, n: "a" }, { id: 2, n: "b" }];
    expect(keepUnchanged(prev, [{ id: 1, n: "a" }, { id: 2, n: "b" }])).toBe(prev);
    expect(keepUnchanged(prev, [{ id: 2, n: "b" }, { id: 1, n: "a" }])).not.toBe(prev);
  });
  it("starts from nothing", () => {
    const next = [{ id: 1 }];
    expect(keepUnchanged([], next)).toEqual(next);
  });
});
