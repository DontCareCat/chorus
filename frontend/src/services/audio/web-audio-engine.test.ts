import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebAudioPlaybackEngine } from "./web-audio-engine";

type Call = [string, ...number[]];

class FakeParam {
  calls: Call[] = [];
  cancelScheduledValues(t: number) { this.calls.push(["cancel", t]); }
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(["ramp", v, t]); }
  setTargetAtTime(v: number, t: number, tc: number) { this.calls.push(["target", v, t, tc]); }
}

class FakeNode {
  gain = new FakeParam();
  fftSize = 0;
  connected: unknown[] = [];
  connect(n: unknown) { this.connected.push(n); return n; }
  disconnect() {}
  getFloatTimeDomainData(a: Float32Array) { a.fill(0.5); }
}

class FakeCtx {
  currentTime = 10;
  state = "running";
  destination = {};
  resumed = 0;
  nodes: FakeNode[] = [];
  createMediaElementSource(_: unknown) { const n = new FakeNode(); this.nodes.push(n); return n; }
  createGain() { const n = new FakeNode(); this.nodes.push(n); return n; }
  createAnalyser() { const n = new FakeNode(); this.nodes.push(n); return n; }
  async resume() { this.resumed++; this.state = "running"; }
}

class FakeAudio extends EventTarget {
  currentTime = 0;
  duration = 100;
  playbackRate = 1;
  seeking = false;
  ended = false;
  error: { message: string } | null = null;
  played = 0;
  rejectPlay = false;
  async play() { if (this.rejectPlay) throw new Error("NotAllowedError"); this.played++; }
  pause() { this.dispatchEvent(new Event("pause")); }
}

let ctx: FakeCtx, audio: FakeAudio, engine: WebAudioPlaybackEngine, param: FakeParam;
const gainParam = () => (ctx.nodes[1] as FakeNode).gain;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = new FakeCtx();
  audio = new FakeAudio();
  engine = new WebAudioPlaybackEngine(audio as unknown as HTMLAudioElement, ctx as unknown as AudioContext);
  param = gainParam();
  param.calls.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("graph", () => {
  it("routes the element through the fade gain, the master volume and the analyser to the destination", () => {
    const [source, fade, master, analyser] = ctx.nodes as FakeNode[];
    expect(source!.connected).toEqual([fade]);
    expect(fade!.connected).toEqual([master]);
    expect(master!.connected).toEqual([analyser]);
    expect(analyser!.connected).toEqual([ctx.destination]);
  });
});

describe("master volume (the player's setting)", () => {
  const masterParam = () => (ctx.nodes[2] as FakeNode).gain;
  it("starts at full volume", () => {
    expect(engine.getMasterVolume()).toBe(1);
  });
  it("is applied smoothly (a short exponential approach), never as a jump", () => {
    masterParam().calls.length = 0;
    engine.setMasterVolume(0.4);
    expect(masterParam().calls).toEqual([["target", 0.4, 10, 0.02]]);
    expect(engine.getMasterVolume()).toBe(0.4);
  });
  it("is clamped to 0..1 and ignores garbage", () => {
    engine.setMasterVolume(5);
    expect(engine.getMasterVolume()).toBe(1);
    engine.setMasterVolume(-2);
    expect(engine.getMasterVolume()).toBe(0);
    engine.setMasterVolume(Number.NaN);
    expect(engine.getMasterVolume()).toBe(1);
  });
  it("never touches the fade gain — and fades never touch the master", async () => {
    param.calls.length = 0;
    masterParam().calls.length = 0;
    engine.setMasterVolume(0.3);
    expect(param.calls).toEqual([]); // the fade gain was not touched
    const p = engine.fadeOut(400);
    ctx.currentTime = 10.4;
    vi.advanceTimersByTime(400);
    await p;
    engine.setVolume(1);
    expect(masterParam().calls).toEqual([["target", 0.3, 10, 0.02]]); // only the one volume change
    expect(engine.getMasterVolume()).toBe(0.3);
    expect(engine.getVolume()).toBe(1); // the fade value is its own thing
  });
});

describe("fades", () => {
  it("fadeOut is a linear ramp anchored at the current gain, never an abrupt set to 0", async () => {
    const p = engine.fadeOut(400);
    expect(param.calls).toEqual([["cancel", 10], ["set", 1, 10], ["ramp", 0, 10.4]]);
    ctx.currentTime = 10.4;
    vi.advanceTimersByTime(400);
    await expect(p).resolves.toBe(true);
    expect(engine.getVolume()).toBe(0);
  });

  it("getVolume follows the ramp on the audio clock", () => {
    void engine.fadeOut(400);
    ctx.currentTime = 10.1;
    expect(engine.getVolume()).toBeCloseTo(0.75, 5);
    ctx.currentTime = 10.2;
    expect(engine.getVolume()).toBeCloseTo(0.5, 5);
  });

  it("cancelFade freezes the gain where it is (no jump) and reports false", async () => {
    const p = engine.fadeOut(400);
    ctx.currentTime = 10.1; // gain 0.75
    engine.cancelFade();
    await expect(p).resolves.toBe(false);
    expect(engine.getVolume()).toBeCloseTo(0.75, 5);
    expect(param.calls.slice(-2)).toEqual([["cancel", 10.1], ["set", expect.closeTo(0.75, 5), 10.1]]);
    vi.advanceTimersByTime(1000); // the cancelled fade's timer must not fire later
    expect(engine.getVolume()).toBeCloseTo(0.75, 5);
  });

  it("an interrupted fade-out followed by fade-in starts from the frozen gain and ends at 1", async () => {
    const out = engine.fadeOut(400);
    ctx.currentTime = 10.2; // gain 0.5
    const inn = engine.fadeIn(400);
    await expect(out).resolves.toBe(false);
    const ramp = param.calls.filter((c) => c[0] === "ramp").at(-1)!;
    expect(ramp).toEqual(["ramp", 1, expect.closeTo(10.6, 5)]);
    expect(param.calls.filter((c) => c[0] === "set").at(-1)).toEqual(["set", expect.closeTo(0.5, 5), 10.2]);
    ctx.currentTime = 10.6;
    vi.advanceTimersByTime(400);
    await expect(inn).resolves.toBe(true);
    expect(engine.getVolume()).toBe(1);
  });

  it("a fade to the value it already has resolves immediately without ramping", async () => {
    await expect(engine.fadeIn(400)).resolves.toBe(true);
    expect(param.calls.some((c) => c[0] === "ramp")).toBe(false);
  });

  it("a zero-length fade applies the target directly", async () => {
    await expect(engine.fadeOut(0)).resolves.toBe(true);
    expect(engine.getVolume()).toBe(0);
  });

  it("setVolume cancels a running fade", async () => {
    const p = engine.fadeOut(400);
    engine.setVolume(1);
    await expect(p).resolves.toBe(false);
    expect(engine.getVolume()).toBe(1);
  });

  it("measures the output level from the analyser", () => {
    expect(engine.getOutputLevel()).toBeCloseTo(0.5, 5);
  });
});

describe("play / pause / seek", () => {
  it("play resumes a suspended AudioContext (autoplay policy) before playing", async () => {
    ctx.state = "suspended";
    await engine.play();
    expect(ctx.resumed).toBe(1);
    expect(audio.played).toBe(1);
  });

  it("play rejects when the browser blocks playback", async () => {
    audio.rejectPlay = true;
    await expect(engine.play()).rejects.toThrow("NotAllowedError");
  });

  it("seek resolves on the 'seeked' event and sets the position", async () => {
    const p = engine.seek(45.3);
    expect(audio.currentTime).toBe(45.3);
    audio.dispatchEvent(new Event("seeked"));
    await expect(p).resolves.toBeUndefined();
  });

  it("seek to the current position resolves immediately", async () => {
    audio.currentTime = 12;
    await expect(engine.seek(12)).resolves.toBeUndefined();
  });

  it("seek is clamped to the duration and to 0", async () => {
    void engine.seek(500);
    expect(audio.currentTime).toBe(100);
    audio.dispatchEvent(new Event("seeked"));
    void engine.seek(-3);
    expect(audio.currentTime).toBe(0);
  });

  it("a seek that never completes rejects after the timeout", async () => {
    const p = engine.seek(30);
    const assertion = expect(p).rejects.toThrow("timed out");
    vi.advanceTimersByTime(9000);
    await assertion;
  });
});

describe("events", () => {
  it("maps media events to engine states and errors", () => {
    const states: string[] = [];
    const errors: string[] = [];
    engine.onStateChange((s) => states.push(s));
    engine.onError((m) => errors.push(m));
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("waiting"));
    audio.dispatchEvent(new Event("pause"));
    audio.ended = true;
    audio.dispatchEvent(new Event("pause")); // browsers fire 'pause' before 'ended'
    audio.dispatchEvent(new Event("ended"));
    audio.error = { message: "decode failed" };
    audio.dispatchEvent(new Event("error"));
    expect(states).toEqual(["playing", "buffering", "paused", "ended", "ended"]);
    expect(errors).toEqual(["decode failed"]);
  });

  it("unsubscribe and dispose stop events", () => {
    const states: string[] = [];
    const off = engine.onStateChange((s) => states.push(s));
    off();
    audio.dispatchEvent(new Event("playing"));
    const other: string[] = [];
    engine.onStateChange((s) => other.push(s));
    engine.dispose();
    audio.dispatchEvent(new Event("playing"));
    expect(states).toEqual([]);
    expect(other).toEqual([]);
  });
});
