import { describe, expect, it } from "vitest";
import { fmt, letterStep, resultCounts, resultText, tierFor } from "./LookupBar";
import { en } from "../i18n/en";
import type { SongDto } from "../services/api";

const song = (id: number, lyrics_status: SongDto["lyrics_status"]) => ({ id, lyrics_status }) as SongDto;
const songs = [song(1, "found"), song(2, "found"), song(3, "needs_choice"), song(4, "not_found"), song(5, "found"), song(6, "pending")];

describe("the lookup bar's words", () => {
  it("says what happened to the songs of the run, and leaves out what did not happen", () => {
    expect(resultText(songs, new Set([1, 2, 3, 4]))).toBe("Done: 2 found, 1 needs a choice, 1 not found");
    expect(resultText(songs, new Set([1, 2]))).toBe("Done: 2 found");
    expect(resultText(songs, new Set([]))).toBe("Done");
    expect(resultCounts(songs, new Set([1, 3, 4, 6]))).toEqual({ found: 1, choose: 1, none: 1 });
  });
  it("has a mid form that drops the zero parts, and a counter that is never empty", () => {
    expect(en.library.lookupDoneMid(31, 6, 4)).toBe("31 found · 6 to choose · 4 not found");
    expect(en.library.lookupDoneMid(31, 0, 0)).toBe("31 found");
    expect(en.library.lookupDoneMid(0, 0, 0)).toBe("Done");
    expect(en.library.lookupCountShort(12, 41)).toBe("12/41");
    expect(en.library.lookupCount(0, 41)).toBe("0 of 41");
  });
  it("picks the tier from the bar's width", () => {
    expect([319, 339, 340, 599, 600, 1280].map(tierFor)).toEqual(["S", "S", "M", "M", "L", "L"]);
  });
  it("separates thousands with a thin space", () => {
    expect(fmt(41)).toBe("41");
    expect(fmt(1170)).toBe("1 170");
    expect(fmt(12345)).toBe("12 345");
  });
  it("never lets the letters take longer than their cap", () => {
    expect(letterStep(14, 420, 10)).toBe(14);
    expect(letterStep(24, 600, 80) * 80).toBeLessThanOrEqual(600);
    expect(letterStep(24, 600, 0)).toBe(24);
  });
});
