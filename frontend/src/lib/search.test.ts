import { describe, expect, it } from "vitest";
import { buildMatcher } from "./search";

const song = (title: string, artist = "Band", album: string | null = null, file_name = "x.mp3") => ({ title, artist, album, file_name });
const names = (query: string, regex: boolean, list = LIST) => list.filter(buildMatcher(query, regex).test).map((s) => s.title);
const LIST = [
  song("Du hast", "Rammstein", "Sehnsucht", "01 - Du hast.mp3"),
  song("Sonne", "Rammstein", "Mutter", "02 - Sonne.flac"),
  song("Nur noch kurz die Welt retten", "Tim Bendzko", null, "tim.mp3"),
  song("99 Luftballons", "Nena", "Nena", "nena_99.mp3"),
];

describe("plain search", () => {
  it("matches every word in any order and any field, ignoring case", () => {
    expect(names("rammstein", false)).toEqual(["Du hast", "Sonne"]);
    expect(names("HAST du", false)).toEqual(["Du hast"]);
    expect(names("mutter sonne", false)).toEqual(["Sonne"]);  // album + title
    expect(names("flac", false)).toEqual(["Sonne"]);  // file name
    expect(names("", false)).toHaveLength(4);
    expect(names("   ", false)).toHaveLength(4);
    expect(names("xyz", false)).toEqual([]);
  });
  it("treats regex characters literally", () => {
    expect(names("99 (", false)).toEqual([]);
    expect(buildMatcher("(", false).error).toBeNull();
  });
});

describe("regex search", () => {
  it("anchors, alternatives and classes work on each field", () => {
    expect(names("^du", true)).toEqual(["Du hast"]);
    expect(names("sonne|welt", true)).toEqual(["Sonne", "Nur noch kurz die Welt retten"]);
    expect(names("\\d{2} luft", true)).toEqual(["99 Luftballons"]);
    expect(names("^0\\d - ", true)).toEqual(["Du hast", "Sonne"]);  // the file names
    expect(names("(?:nena)$", true)).toEqual(["99 Luftballons"]);
  });
  it("ignores case", () => expect(names("RAMMSTEIN", true)).toEqual(["Du hast", "Sonne"]));
  it("an invalid pattern leaves the list alone and explains", () => {
    const m = buildMatcher("(unclosed", true);
    expect(m.error).toMatch(/./);
    expect(LIST.filter(m.test)).toHaveLength(4);
    expect(buildMatcher("[a-", true).error).toBeTruthy();
  });
  it("refuses a very long pattern", () => expect(buildMatcher("a".repeat(201), true).error).toMatch(/too long/));
  it("empty is everything and no error", () => {
    expect(buildMatcher("", true)).toMatchObject({ error: null });
    expect(names("", true)).toHaveLength(4);
  });
});
