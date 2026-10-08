import { describe, expect, it } from "vitest";
import { computeRunway } from "./runway";
import type { SyncQuestion } from "./synchronization";
import { describeStatus } from "./status";

const q = (id: number, start: number, end: number): SyncQuestion => ({ id, sequence: id, startTime: start, endTime: end, recoveryTime: start });
const none = new Set<number>();

describe("computeRunway", () => {
  const qs = [q(1, 10, 14), q(2, 40, 44), q(3, 80, 84)];
  it("positions ticks, playhead and the deadline of the earliest unanswered question", () => {
    const r = computeRunway({ duration: 100, currentTime: 25, questions: qs, answered: new Set([1]) });
    expect(r.playheadPct).toBe(25);
    expect(r.ticks.map((t) => [t.id, t.pct, t.answered])).toEqual([[1, 10, true], [2, 40, false], [3, 80, false]]);
    expect(r.blockingId).toBe(2);
    expect(r.deadlinePct).toBe(47); // 44 + 3
    expect(r.slack).toBe(22);
    expect(r.ahead).toBe(15);
  });
  it("ahead is 0 once the audio is inside or past the blocking question", () => {
    const r = computeRunway({ duration: 100, currentTime: 42, questions: qs, answered: new Set([1]) });
    expect(r.ahead).toBe(0);
    expect(r.slack).toBe(5);
  });
  it("nothing blocks when everything is answered", () => {
    const r = computeRunway({ duration: 100, currentTime: 5, questions: qs, answered: new Set([1, 2, 3]) });
    expect([r.deadlinePct, r.slack, r.ahead, r.blockingId]).toEqual([null, null, null, null]);
  });
  it("clamps to the track and survives a zero duration", () => {
    expect(computeRunway({ duration: 100, currentTime: 140, questions: [q(1, 90, 99)], answered: none }).deadlinePct).toBe(100);
    expect(computeRunway({ duration: 0, currentTime: 5, questions: qs, answered: none }).playheadPct).toBe(0);
  });
});

describe("describeStatus", () => {
  const runway = (t: number) => computeRunway({ duration: 100, currentTime: t, questions: [q(1, 40, 44)], answered: none });
  it("says how far ahead the player is", () => {
    expect(describeStatus({ state: "PLAYING", error: null, runway: runway(10), freePlay: false }).text).toBe("You are 30 s ahead. The audio runs on.");
  });
  it("counts down the last seconds and turns to a warning inside the grace period", () => {
    const calm = describeStatus({ state: "PLAYING", error: null, runway: runway(42), freePlay: false });
    expect(calm).toEqual({ text: "The audio waits for you in 5 s.", tone: "calm" });
    const warn = describeStatus({ state: "PLAYING", error: null, runway: runway(45), freePlay: false });
    expect(warn.tone).toBe("warn");
    expect(warn.text).toBe("The audio waits for you in 2 s.");
  });
  it("explains each recovery state", () => {
    const r = runway(50);
    expect(describeStatus({ state: "PAUSED_FOR_QUESTION", error: null, runway: r, freePlay: false }).text).toMatch(/Waiting for you/);
    expect(describeStatus({ state: "SEEKING", error: null, runway: r, freePlay: false }).text).toMatch(/previous line/);
  });
  it("distinguishes a blocked autoplay from other errors, and free play", () => {
    expect(describeStatus({ state: "ERROR", error: "play_rejected: NotAllowedError", runway: null, freePlay: false }).text).toMatch(/blocked/);
    expect(describeStatus({ state: "ERROR", error: "decode error", runway: null, freePlay: false }).text).toMatch(/Playback problem/);
    expect(describeStatus({ state: "PLAYING", error: null, runway: null, freePlay: true }).text).toMatch(/Free play/);
  });
});

describe("runway ticks are per line, not per question", () => {
  const same = (id: number, start: number) => ({ id, sequence: id, startTime: start, endTime: start + 4, recoveryTime: start });
  const qs = [same(1, 10), same(2, 10), same(3, 10), same(4, 40)];
  it("collapses questions that share a line into one tick", () => {
    const r = computeRunway({ duration: 100, currentTime: 0, questions: qs, answered: new Set() });
    expect(r.ticks.map((t) => [t.id, t.pct, t.count, t.answered])).toEqual([[1, 10, 3, false], [4, 40, 1, false]]);
  });
  it("focuses the first OPEN question of the line and is only 'answered' when all are", () => {
    expect(computeRunway({ duration: 100, currentTime: 0, questions: qs, answered: new Set([1]) }).ticks[0]).toMatchObject({ id: 2, answered: false });
    expect(computeRunway({ duration: 100, currentTime: 0, questions: qs, answered: new Set([1, 2, 3]) }).ticks[0]).toMatchObject({ id: 1, answered: true });
  });
  it("the earliest open question of a line still sets the deadline", () => {
    const r = computeRunway({ duration: 100, currentTime: 0, questions: qs, answered: new Set([1]) });
    expect(r.blockingId).toBe(2);
    expect(r.deadlinePct).toBe(17); // 14 + 3
  });
});
