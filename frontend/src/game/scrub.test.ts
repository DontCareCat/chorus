import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scrub } from "./scrub";
import type { ScrubHost } from "./scrub";
import { secondsPerPx } from "./strip";

const flush = () => Promise.resolve().then(() => Promise.resolve());

function rig(all: Omit<Partial<ScrubHost>, "time"> & { time?: number } = {}) {
  const { time, ...over } = all;
  const calls: string[] = [];
  const st = { time: time ?? 60, playing: true };
  const host: ScrubHost = {
    time: () => st.time,
    duration: () => 225,
    limit: () => 225,
    width: () => 184,
    halfWindow: () => 12,
    start: () => { calls.push("start"); return { wasPlaying: st.playing }; },
    end: async (t, w) => { calls.push(`end ${t.toFixed(2)} ${w}`); st.time = t; },
    onGate: () => calls.push("gate"),
    ...over,
  };
  return { s: new Scrub(host), calls, st, spp: secondsPerPx(12, 184) };
}

describe("scrub gesture", () => {
  it("a tap does nothing", () => {
    const { s, calls } = rig();
    s.down(100, 0); s.move(103, 10); s.up(20);
    expect(calls).toEqual([]);
    expect(s.busy).toBe(false);
  });
  it("starts after 6px: pauses once, then the strip follows the finger 1:1 (dragging left goes forward)", () => {
    const { s, calls, spp } = rig();
    s.down(100, 0); s.move(95, 10);
    expect(calls).toEqual([]); // 5px: not yet
    s.move(80, 20);
    expect(calls).toEqual(["start"]);
    expect(s.target).toBeCloseTo(60 + 20 * spp, 5);
    s.move(130, 30);
    expect(calls).toEqual(["start"]); // only once
    expect(s.target).toBeCloseTo(60 - 30 * spp, 5);
    expect(s.from).toBe(60);
  });
  it("released without speed: seeks at once and resumes if it was playing", async () => {
    const { s, calls, spp } = rig();
    s.down(100, 0); s.move(60, 100); s.move(60, 400); s.up(500);
    await flush();
    expect(calls).toEqual(["start", `end ${(60 + 40 * spp).toFixed(2)} true`]);
    expect(s.busy).toBe(false);
  });
  it("a paused song stays paused: end() is told it was not playing", async () => {
    const { s, calls, st } = rig();
    st.playing = false;
    s.down(100, 0); s.move(60, 100); s.move(60, 400); s.up(500);
    await flush();
    expect(calls[1]).toMatch(/ false$/);
  });
  it("a flick coasts at the speed of the last 80 ms and stops by itself, then seeks", async () => {
    const { s, calls } = rig();
    s.down(100, 0); s.move(90, 40); s.move(70, 80); s.up(90); // 20px in 40 ms = 0.5 px/ms
    expect(calls).toEqual(["start"]);
    const start = s.target!;
    let ms = 0;
    while (s.busy && ms < 5000) { s.frame(16); ms += 16; await flush(); }
    expect(s.target).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^end /);
    expect(ms).toBeGreaterThan(60);
    expect(ms).toBeLessThan(200); // 0.375 px/ms slowing by 0.004 px/ms²: about 94 ms
    expect(start).toBeLessThan(80); // the flick was forward
  });
  it("a finger that rested before lifting does not coast", async () => {
    const { s, calls } = rig();
    s.down(100, 0); s.move(60, 40); s.up(300);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/^end /);
  });
  it("forward stops at the limit (the first open question) and says so once per hit", () => {
    const { s, calls } = rig({ limit: () => 62 });
    s.down(100, 0); s.move(0, 50); // 100px = ~ 7 s
    expect(s.target).toBe(62);
    expect(calls).toContain("gate");
  });
  it("backward is free down to 0", () => {
    const { s } = rig({ time: 5 });
    s.down(100, 0); s.move(400, 50);
    expect(s.target).toBe(0);
  });
  it("is refused while the game recovers by itself", () => {
    const { s, calls } = rig({ start: () => null });
    s.down(100, 0); s.move(60, 50);
    expect(s.busy).toBe(false);
    expect(calls).toEqual([]);
  });
  it("reduced motion: no coasting", async () => {
    const { s, calls } = rig({ reducedMotion: () => true });
    s.down(100, 0); s.move(90, 40); s.move(70, 80); s.up(90);
    await flush();
    expect(calls).toHaveLength(2);
  });
});

describe("keys", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("±5 s accumulate while a key repeats and commit once after it stops", async () => {
    const { s, calls } = rig({ time: 60 });
    s.nudge(5); s.nudge(5); s.nudge(-5);
    expect(s.target).toBe(65);
    expect(calls).toEqual(["start"]);
    vi.advanceTimersByTime(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["start", "end 65.00 true"]);
  });
  it("Home and End; End stops at the limit", async () => {
    const { s, calls } = rig({ limit: () => 100 });
    s.jump(1e9);
    expect(s.target).toBe(100);
    s.jump(0);
    expect(s.target).toBe(0);
    vi.advanceTimersByTime(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.filter((c) => c.startsWith("end"))).toEqual(["end 0.00 true"]);
  });
});
