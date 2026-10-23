import { describe, expect, it } from "vitest";
import { facetCounts, visibleSongs, type FacetSong } from "./library-facets";

const s = (id: number, language: string, ready: boolean, available = true): FacetSong => ({ id, language, lyrics_status: ready ? "found" : "not_found", available });
const songs = [s(1, "de", true), s(2, "de", false), s(3, "fr", true), s(4, "fr", false), s(5, "en", true, false)];
const all = { status: "all" as const, language: "all", matches: () => true, duplicateIds: new Set<number>() };

describe("facetCounts", () => {
  it("counts everything when nothing is chosen", () => {
    const c = facetCounts(songs, all);
    expect(c.status).toEqual({ all: 5, ready: 2, missing: 3, duplicates: 0 }); // an unavailable file is not ready
    expect(c.languages.map((l) => [l.code, l.count])).toEqual([["de", 2], ["fr", 2], ["en", 1]]);
  });
  it("status counts follow the chosen language", () => {
    const c = facetCounts(songs, { ...all, language: "de" });
    expect(c.status).toEqual({ all: 2, ready: 1, missing: 1, duplicates: 0 });
    expect(c.languages.map((l) => l.code)).toEqual(["de", "fr", "en"]); // the language chips ignore the language filter itself
  });
  it("language counts follow the chosen status", () => {
    const c = facetCounts(songs, { ...all, status: "ready" });
    expect(c.languages.map((l) => [l.code, l.count])).toEqual([["de", 1], ["fr", 1]]);
    expect(c.status.all).toBe(5);
  });
  it("both follow the search", () => {
    const c = facetCounts(songs, { ...all, matches: (x) => x.id <= 2 });
    expect(c.status.all).toBe(2);
    expect(c.languages).toEqual([{ code: "de", count: 2 }]);
  });
  it("the duplicates count is limited by the other filters", () => {
    const c = facetCounts(songs, { ...all, language: "fr", duplicateIds: new Set([2, 3]) });
    expect(c.status.duplicates).toBe(1);
  });
});

describe("visibleSongs", () => {
  it("applies status, language and search together", () => {
    expect(visibleSongs(songs, { ...all, status: "missing", language: "fr" }).map((x) => x.id)).toEqual([4]);
    expect(visibleSongs(songs, { ...all, status: "duplicates", duplicateIds: new Set([2, 4]) }).map((x) => x.id)).toEqual([2, 4]);
  });
});
