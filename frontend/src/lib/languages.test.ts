import { describe, expect, it } from "vitest";
import { inLanguage, languageCounts } from "./languages";

const songs = ["de", "en", "de", "fr", "en", "de", "es"].map((language) => ({ language }));

describe("language filter", () => {
  it("counts the songs of every language, the biggest first, ties by code", () => {
    expect(languageCounts(songs)).toEqual([{ code: "de", count: 3 }, { code: "en", count: 2 }, { code: "es", count: 1 }, { code: "fr", count: 1 }]);
    expect(languageCounts([])).toEqual([]);
  });
  it("filters by one language or shows all", () => {
    expect(songs.filter((s) => inLanguage(s, "en"))).toHaveLength(2);
    expect(songs.filter((s) => inLanguage(s, "all"))).toHaveLength(7);
    expect(songs.filter((s) => inLanguage(s, "it"))).toHaveLength(0);
  });
});
