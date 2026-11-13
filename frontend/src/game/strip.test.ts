import { describe, expect, it } from "vitest";
import { buildStripLines, layoutStrip, lens, loudAt, mmss, packPeaks, peaksFromSamples, scrubLimit, secondsPerPx, timeLeft, unpackPeaks } from "./strip";
import type { SyncQuestion } from "./synchronization";
import type { QuestionResult } from "./results";

const Q = (id: number, start: number, end = start + 3): SyncQuestion => ({ id, sequence: id, startTime: start, endTime: end, recoveryTime: start - 2 });

describe("time left", () => {
  it("is -m:ss and -0:00 at the end", () => {
    expect(timeLeft(225, 0)).toBe("-3:45");
    expect(timeLeft(225, 224.2)).toBe("-0:00");
    expect(timeLeft(225, 224)).toBe("-0:01");
    expect(timeLeft(225, 225)).toBe("-0:00");
    expect(timeLeft(225, 300)).toBe("-0:00");
    expect(mmss(102.9)).toBe("1:42");
  });
});

describe("lens", () => {
  it("is 1 at the centre and 0 visible at the edge; height shrinks to 0.4", () => {
    expect(lens(0)).toEqual({ sx: 0, d: 0, h: 1, o: 1 });
    const e = lens(1);
    expect(e.h).toBeCloseTo(0.4, 5);
    expect(e.o).toBeCloseTo(0, 5);
  });
  it("compresses spacing towards the edges (sin) and is symmetric", () => {
    expect(lens(0.5).sx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(lens(-0.5).sx).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(lens(0.5).sx).toBeGreaterThan(0.5); // a point at half the window is already further than half the width out
  });
  it("seconds per px at the centre matches the lens slope", () => {
    expect(secondsPerPx(12, 184)).toBeCloseTo(12 / (92 * (Math.PI / 2)), 8);
  });
});

describe("question lines", () => {
  const res = (o: Partial<QuestionResult>): QuestionResult => ({ selectedOptionId: 1, ...o });
  it("one per lyric line; open while any question is open; otherwise the worst (wrong > almost > correct)", () => {
    const qs = [Q(1, 10), Q(2, 10), Q(3, 20), Q(4, 20), Q(5, 30), Q(6, 40)];
    const answered = new Set([1, 2, 3, 4, 5]);
    const results = new Map<number, QuestionResult>([
      [1, res({ correct: true })], [2, res({ correct: false })],
      [3, res({ match: "full" })], [4, res({ match: "partial" })],
      [5, res({ correct: true })],
    ]);
    const lines = buildStripLines(qs, answered, results);
    expect(lines.map((l) => [l.t, l.result])).toEqual([[10, "wrong"], [20, "almost"], [30, "correct"], [40, "open"]]);
    expect(lines.map((l) => l.cap)).toEqual([false, false, false, true]); // the first open question wears the cap
  });
  it("a line with one open question stays open even if another is wrong", () => {
    const lines = buildStripLines([Q(1, 10), Q(2, 10)], new Set([1]), new Map([[1, res({ correct: false })]]));
    expect(lines[0]).toMatchObject({ result: "open", cap: true });
  });
  it("an answer the server has not judged yet is not coloured", () => {
    expect(buildStripLines([Q(1, 10)], new Set([1]), new Map([[1, res({})]]))[0]!.result).toBe("open");
  });
});

describe("scrub limit", () => {
  it("is the first open question's end + 3 s, else the end of the song", () => {
    expect(scrubLimit([Q(1, 10, 13), Q(2, 30, 33)], new Set([1]), 200)).toBe(36);
    expect(scrubLimit([Q(1, 10, 13)], new Set([1]), 200)).toBe(200);
  });
});

describe("strip layout", () => {
  const base = { duration: 225, width: 184, height: 44, halfWindow: 12, peaks: null, lines: [] };
  it("puts a loudness line every 4px and the one at now in the middle", () => {
    const { ticks } = layoutStrip({ ...base, now: 60 });
    expect(ticks.length).toBeGreaterThan(40);
    expect(ticks.length).toBeLessThanOrEqual(184 / 4 + 1);
    const centre = ticks.find((t) => Math.abs(t.x + 0.75 - 92) < 0.01);
    expect(centre).toBeTruthy();
    expect(ticks.every((t) => t.h >= 3 && t.h <= 44)).toBe(true);
    expect(ticks.filter((t) => t.played).every((t) => t.x + 0.75 <= 92)).toBe(true);
  });
  it("without loudness data every line is 35% of the strip high", () => {
    const { ticks } = layoutStrip({ ...base, now: 60 });
    const mid = ticks.find((t) => Math.abs(t.x + 0.75 - 92) < 0.01)!;
    expect(mid.h).toBeCloseTo(44 * 0.35, 5);
  });
  it("loudness sets the height between 4px and 70% of the strip", () => {
    const quiet = layoutStrip({ ...base, now: 60, peaks: { values: new Float32Array(3000).fill(0), perSecond: 10 } }).ticks.find((t) => t.x > 91 && t.x < 93)!;
    const loud = layoutStrip({ ...base, now: 60, peaks: { values: new Float32Array(3000).fill(1), perSecond: 10 } }).ticks.find((t) => t.x > 91 && t.x < 93)!;
    expect(quiet.h).toBeCloseTo(4, 5);
    expect(loud.h).toBeCloseTo(44 * 0.7, 5);
  });
  it("draws no lines before 0 or after the end", () => {
    expect(layoutStrip({ ...base, now: 2 }).ticks.every((t) => t.x + 0.75 >= 92 - 92 * Math.sin((2 / 12) * Math.PI / 2) - 0.01)).toBe(true);
    expect(layoutStrip({ ...base, now: 224 }).ticks.length).toBeLessThan(layoutStrip({ ...base, now: 100 }).ticks.length);
  });
  it("question lines inside the window only; centred line is full height minus 6", () => {
    const lines = [{ t: 60, result: "open" as const, cap: true }, { t: 100, result: "correct" as const, cap: false }, { t: 66, result: "wrong" as const, cap: false }];
    const { marks } = layoutStrip({ ...base, now: 60, lines });
    expect(marks).toHaveLength(2);
    expect(marks[0]).toMatchObject({ x: 92, h: 38, o: 1, cap: true, result: "open" });
    expect(marks[1]!.h).toBeLessThan(38);
    expect(marks[1]!.o).toBeLessThan(1);
  });
});

describe("loudness data", () => {
  it("interpolates between values", () => {
    const p = { values: Float32Array.from([0, 1]), perSecond: 10 };
    expect(loudAt(p, 0.05)).toBeCloseTo(0.5, 5);
    expect(loudAt(null, 1)).toBeUndefined();
  });
  it("peaksFromSamples: ten values a second, the loudest is 1, silence is 0", () => {
    const rate = 1000, a = new Float32Array(rate * 3);
    for (let i = rate; i < rate * 2; i++) a[i] = 0.5 * (i % 2 ? 1 : -1);
    for (let i = rate * 2; i < rate * 3; i++) a[i] = 0.25 * (i % 2 ? 1 : -1);
    const p = peaksFromSamples([a], rate, 10);
    expect(p.values).toHaveLength(30);
    expect(p.values[0]).toBe(0);
    expect(p.values[15]).toBeCloseTo(1, 5);
    expect(p.values[25]).toBeCloseTo(Math.sqrt(0.5), 4);
  });
  it("pack / unpack round trip", () => {
    const p = { values: Float32Array.from([0, 0.5, 1]), perSecond: 10 };
    const back = unpackPeaks(packPeaks(p))!;
    expect(Array.from(back.values).map((v) => Math.round(v * 255))).toEqual([0, 128, 255]);
    expect(unpackPeaks("zz")).toBeNull();
  });
});
