import { describe, expect, it } from "vitest";
import { MIN_GAP, changeOf, editedCount, emptyHistory, fmt, fmtNow, nudge, parseTime, place, record, redo, setNow, shiftAll, signed, undo } from "./timing-edit";
import type { Times } from "./timing-edit";
import { buildLrc, lengthTag, lrcFileName, stamp } from "./lrc-writer";

const D = 200;
const opt = { ripple: false, duration: D };
const base: Times = [10, 20, 30, 40];

describe("place: lines keep their order", () => {
  it("moves a line inside its neighbours without touching them", () => {
    expect(place(base, 1, 25, opt)).toEqual({ times: [10, 25, 30, 40], pushed: 0 });
  });
  it("pushes later neighbours just far enough (0.05 s apart)", () => {
    const r = place(base, 1, 35, opt);
    expect(r.times).toEqual([10, 35, 35.05, 40]);
    expect(r.pushed).toBe(1);
    expect(place(base, 0, 41, opt).times).toEqual([41, 41.05, 41.1, 41.15]);
    expect(place(base, 0, 41, opt).pushed).toBe(3);
  });
  it("pushes earlier neighbours back the same way", () => {
    const r = place(base, 2, 15, opt);
    expect(r.times).toEqual([10, 14.95, 15, 40]);
    expect(r.pushed).toBe(1);
    expect(place(base, 3, 5, opt).times).toEqual([4.85, 4.9, 4.95, 5]);
  });
  it("never lets an earlier line go below 0", () => {
    const r = place([0.02, 0.5, 10], 2, 0, opt);
    expect(r.times.every((t) => t! >= 0)).toBe(true);
  });
  it("skips lines without a time and keeps them without one", () => {
    const r = place([10, null, 20, null, 30], 0, 25, opt);
    expect(r.times).toEqual([25, null, 25.05, null, 30]);
    expect(r.pushed).toBe(1);
  });
  it("keeps times inside the song (0 .. length - 0.1)", () => {
    expect(place(base, 3, 999, opt).times[3]).toBe(199.9);
    expect(place(base, 0, -5, opt).times[0]).toBe(0);
  });
  it("is always ordered with at least MIN_GAP between timed lines", () => {
    let t: Times = base;
    for (const [i, v] of [[0, 33], [3, 2], [1, 40], [2, 1], [0, 100]] as const) {
      t = place(t, i, v, opt).times;
      for (let k = 1; k < t.length; k++) expect(t[k]! - t[k - 1]!).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
    }
  });
  it("leaves the number of lines alone and does not change its input", () => {
    const input: Times = [1, 2, 3];
    const r = place(input, 1, 50, opt);
    expect(r.times).toHaveLength(3);
    expect(input).toEqual([1, 2, 3]);
  });
});

describe("ripple (move later lines too)", () => {
  const rip = { ripple: true, duration: D };
  it("moves every later line by the same amount and pushes nothing", () => {
    const r = place(base, 1, 25, rip);
    expect(r.times).toEqual([10, 25, 35, 45]);
    expect(r.pushed).toBe(0);
    expect(place(base, 1, 15, rip).times).toEqual([10, 15, 25, 35]);
  });
  it("a line without a time just gets its time", () => {
    expect(place([10, null, 30], 1, 15, rip).times).toEqual([10, 15, 30]);
  });
  it("keeps the later lines inside the song", () => {
    expect(place([10, 190, 195], 0, 50, rip).times).toEqual([50, 199.9, 199.9]);
  });
});

describe("set and nudge", () => {
  it("Set gives the line the current time and chooses the next one; the last line stays", () => {
    expect(setNow(base, 1, 21.234, opt)).toMatchObject({ times: [10, 21.23, 30, 40], next: 2, pushed: 0 });
    expect(setNow(base, 3, 50, opt).next).toBe(3);
  });
  it("nudges by 0.1 and 0.5; an untimed line starts from the playback time", () => {
    expect(nudge(base, 1, 0.1, 0, opt).times[1]).toBe(20.1);
    expect(nudge(base, 1, -0.5, 0, opt).times[1]).toBe(19.5);
    expect(nudge([10, null], 1, 0.1, 12.3, opt).times[1]).toBe(12.4);
  });
  it("a nudge past a neighbour pushes it", () => {
    expect(nudge([10, 10.1], 0, 0.5, 0, opt)).toEqual({ times: [10.5, 10.55], pushed: 1 });
  });
});

describe("shift all", () => {
  it("moves every timed line, leaves untimed ones, stays in the song", () => {
    expect(shiftAll([1, null, 199.8], 0.5, D)).toEqual([1.5, null, 199.9]);
    expect(shiftAll([0.2, 5], -1, D)).toEqual([0, 4]);
  });
});

describe("history", () => {
  it("undoes and redoes, and a new change clears redo", () => {
    let h = emptyHistory;
    let now: Times = [1];
    h = record(h, now); now = [2];
    h = record(h, now); now = [3];
    const u = undo(h, now)!;
    expect(u.times).toEqual([2]);
    const u2 = undo(u.history, u.times)!;
    expect(u2.times).toEqual([1]);
    expect(undo(u2.history, u2.times)).toBeNull();
    const r = redo(u2.history, u2.times)!;
    expect(r.times).toEqual([2]);
    expect(record(r.history, r.times).future).toEqual([]);
    expect(redo(emptyHistory, now)).toBeNull();
  });
  it("keeps at most 100 steps", () => {
    let h = emptyHistory;
    for (let i = 0; i < 150; i++) h = record(h, [i]);
    expect(h.past).toHaveLength(100);
    expect(h.past[0]).toEqual([50]);
  });
});

describe("formats", () => {
  it("formats times as m:ss.cc and the playback position as m:ss.c", () => {
    expect(fmt(55.6)).toBe("0:55.60");
    expect(fmt(null)).toBe("--:--.--");
    expect(fmt(125.999)).toBe("2:06.00");
    expect(fmtNow(56.34)).toBe("0:56.3");
  });
  it("parses 1:02.40, 62.4 and 62,4, and refuses the rest", () => {
    expect(parseTime("1:02.40")).toBeCloseTo(62.4);
    expect(parseTime("62.4")).toBe(62.4);
    expect(parseTime("62,4")).toBe(62.4);
    expect(parseTime(" 0:05 ")).toBe(5);
    for (const bad of ["", "abc", "1:2:3", "-3", "1:75x"]) expect(parseTime(bad)).toBeNull();
  });
  it("says the change in words", () => {
    expect(signed(0.4)).toBe("+0.40");
    expect(signed(-1.2)).toBe("−1.20");
    expect(changeOf(20.4, 20)).toBe("+0.40");
    expect(changeOf(5, null)).toBe("new");
    expect(changeOf(20, 20)).toBe("");
    expect(changeOf(null, null)).toBe("");
    expect(editedCount([1, 2, 3.5, null], [1, 2, 3, null])).toBe(1);
  });
});

describe("lrc writer (the same answers as the backend's)", () => {
  it("stamps and file names", () => {
    expect(stamp(0)).toBe("[00:00.00]");
    expect(stamp(55.6)).toBe("[00:55.60]");
    expect(stamp(61.005)).toBe("[01:01.01]");
    expect(stamp(6000)).toBe("[100:00.00]");
    expect(lengthTag(225)).toBe("3:45");
    expect(lrcFileName("Mara Vell", "Paper Lanterns")).toBe("Mara Vell - Paper Lanterns.lrc");
    expect(lrcFileName("AC/DC", 'Who Made "Who"?')).toBe("AC_DC - Who Made _Who__.lrc");
    expect(lrcFileName("", "Solo")).toBe("Solo.lrc");
  });
  it("writes the header, keeps an empty line's time and leaves untimed lines out", () => {
    const text = buildLrc({ title: "Paper Lanterns", artist: "Mara Vell", album: "Río de papel", duration: 225 }, [{ time: 12.4, text: "Las luces" }, { time: 34.2, text: "" }, { time: null, text: "left out" }]);
    expect(text).toBe("[ti:Paper Lanterns]\n[ar:Mara Vell]\n[al:Río de papel]\n[length:3:45]\n[re:Chorus]\n[00:12.40]Las luces\n[00:34.20]\n");
    expect(buildLrc({ title: "T", artist: "", album: null, duration: 0 }, [{ time: 1, text: "x" }])).toBe("[ti:T]\n[re:Chorus]\n[00:01.00]x\n");
  });
});
