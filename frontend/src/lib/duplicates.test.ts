import { describe, expect, it } from "vitest";
import { findDuplicates, nameKey, titleKey } from "./duplicates";

const song = (id: number, title: string, artist: string, duration: number, file_name: string) => ({ id, title, artist, duration, file_name });

describe("keys", () => {
  it("ignores extension, case, accents and copy marks in file names", () => {
    expect(nameKey("Café Del Mar.mp3")).toBe("cafe del mar");
    expect(nameKey("cafe del mar (1).flac")).toBe("cafe del mar");
    expect(nameKey("cafe del mar - Copy.mp3")).toBe("cafe del mar");
    expect(nameKey("Copy of cafe del mar.mp3")).toBe("cafe del mar");
    expect(nameKey("Track 2 (live).mp3")).toBe("track 2 live");
  });
  it("drops a trailing remark in brackets from titles", () => {
    expect(titleKey("Hello (Remastered 2011)")).toBe("hello");
    expect(titleKey("Hello [Live]")).toBe("hello");
    expect(titleKey("Hello (Part 2) b")).toBe("hello part 2 b");
  });
});

describe("findDuplicates", () => {
  it("finds the same file name in different folders and formats", () => {
    const g = findDuplicates([song(1, "A", "X", 100, "one.mp3"), song(2, "B", "Y", 300, "One.flac"), song(3, "C", "Z", 50, "other.mp3")]);
    expect(g).toEqual([{ ids: [1, 2], reasons: ["file_name"] }]);
  });
  it("finds the same title and artist with nearly the same length", () => {
    const g = findDuplicates([song(1, "Hello", "Adele", 295.2, "a.mp3"), song(2, "hello (remastered)", "ADELE", 296.9, "b.mp3")]);
    expect(g).toEqual([{ ids: [1, 2], reasons: ["metadata"] }]);
  });
  it("keeps same title and artist apart when the lengths differ (live vs studio)", () => {
    expect(findDuplicates([song(1, "Hello", "Adele", 295, "a.mp3"), song(2, "Hello", "Adele", 340, "b.mp3")])).toEqual([]);
  });
  it("does not match different artists with the same title", () => {
    expect(findDuplicates([song(1, "Hello", "Adele", 295, "a.mp3"), song(2, "Hello", "Lionel", 295, "b.mp3")])).toEqual([]);
  });
  it("joins matches into one group and lists both reasons", () => {
    const g = findDuplicates([
      song(1, "Hello", "Adele", 295, "a.mp3"), song(2, "Hello", "Adele", 295, "b.mp3"), song(3, "Other", "Q", 10, "b (1).mp3"),
    ]);
    expect(g).toEqual([{ ids: [1, 2, 3], reasons: ["file_name", "metadata"] }]);
  });
  it("returns nothing for a library without duplicates", () => {
    expect(findDuplicates([song(1, "A", "X", 1, "a.mp3"), song(2, "B", "X", 1, "b.mp3")])).toEqual([]);
  });
});
