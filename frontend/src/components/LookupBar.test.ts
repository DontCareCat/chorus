// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { advanceRun, fmt, letterStep, loadRun, resultCounts, resultText, tierFor } from "./LookupBar";
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

describe("the run's count", () => {
  it("keeps what is done when the page is left and opened again, and grows when songs are added", () => {
    let run = advanceRun(null, 100, Array.from({ length: 100 }, (_, i) => i), 1000);
    expect(run).toMatchObject({ total: 100, last: 100 });
    run = advanceRun(run, 70, Array.from({ length: 70 }, (_, i) => i + 30), 2000); // 30 done
    expect(run.total).toBe(100);
    const stored = JSON.parse(JSON.stringify(run)); // closed and opened again: the same run
    run = advanceRun(stored, 70, Array.from({ length: 70 }, (_, i) => i + 30), 3000);
    expect(run.total - run.last).toBe(30); // still "30 of 100"
    run = advanceRun(run, 95, Array.from({ length: 95 }, (_, i) => i + 30), 4000); // 25 songs added meanwhile
    expect(run.total).toBe(125);
    expect(run.total - run.last).toBe(30);
    expect(run.ids.length).toBe(125);
  });
  it("forgets a stored run that is too old", () => {
    localStorage.setItem("chorus-lookup-run", JSON.stringify({ ids: [1], total: 5, last: 3, at: 0 }));
    expect(loadRun(10 * 24 * 3600_000)).toBeNull();
    expect(loadRun(1000)).toMatchObject({ total: 5 });
    localStorage.clear();
  });
});
