import { describe, expect, it } from "vitest";
import { boardHeading, ordinal, scoresMatcher } from "./scores-view";

describe("ordinal", () => {
  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
});

describe("scoresMatcher", () => {
  const m = (q: string) => scoresMatcher(q);
  it("matches everything for an empty query", () => expect(m("  ")("A", "B")).toBe(true));
  it("looks at title and artist, ignoring case and accents", () => {
    expect(m("brucke")("Die Brücke", "The Hirsch Effekt")).toBe(true);
    expect(m("HIRSCH")("Die Brücke", "The Hirsch Effekt")).toBe(true);
    expect(m("cafe")("Café del Mar", "x")).toBe(true);
  });
  it("needs every word", () => {
    expect(m("brucke effekt")("Die Brücke", "The Hirsch Effekt")).toBe(true);
    expect(m("brucke xyz")("Die Brücke", "The Hirsch Effekt")).toBe(false);
  });
});

describe("boardHeading", () => {
  it("says how much of the board is shown", () => {
    expect(boardHeading(18, 10, true)).toBe("Top 10 of 18");
    expect(boardHeading(5, 5, true)).toBe("All 5 players");
    expect(boardHeading(1, 1, true)).toBe("Only you so far");
    expect(boardHeading(1, 1, false)).toBe("All 1 players");
  });
});
