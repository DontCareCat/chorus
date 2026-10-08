import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlAudioPlaybackEngine } from "./html-audio-engine";

class FakeAudio extends EventTarget {
  volume = 1;
  currentTime = 0;
  duration = 100;
  paused = true;
  ended = false;
  seeking = false;
  playbackRate = 1;
  error: { message: string } | null = null;
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event("playing")); });
  pause = vi.fn(() => { this.paused = true; this.dispatchEvent(new Event("pause")); });
}

let audio: FakeAudio;
let engine: HtmlAudioPlaybackEngine;
beforeEach(() => {
  vi.useFakeTimers();
  audio = new FakeAudio();
  engine = new HtmlAudioPlaybackEngine(audio as unknown as HTMLAudioElement);
});
afterEach(() => {
  engine.dispose();
  vi.useRealTimers();
});

describe("HtmlAudioPlaybackEngine", () => {
  it("fades the element's volume down smoothly and resolves true", async () => {
    const seen: number[] = [];
    const done = engine.fadeOut(400);
    for (let i = 0; i < 25; i++) { await vi.advanceTimersByTimeAsync(20); seen.push(audio.volume); }
    expect(await done).toBe(true);
    expect(seen.every((v, i) => i === 0 || v <= seen[i - 1]! + 1e-9)).toBe(true);
    expect(seen.some((v) => v > 0.2 && v < 0.8)).toBe(true); // a ramp, not a step
    expect(audio.volume).toBe(0);
    expect(engine.getVolume()).toBe(0);
  });

  it("freezes where it was when a fade is cancelled, and the next fade starts from there", async () => {
    const out = engine.fadeOut(400);
    await vi.advanceTimersByTimeAsync(200);
    engine.cancelFade();
    expect(await out).toBe(false);
    const frozen = audio.volume;
    expect(frozen).toBeGreaterThan(0.3);
    expect(frozen).toBeLessThan(0.7);
    await vi.advanceTimersByTimeAsync(300);
    expect(audio.volume).toBe(frozen); // nothing moves after the cancel
    const back = engine.fadeIn(400);
    await vi.advanceTimersByTimeAsync(20);
    expect(audio.volume).toBeGreaterThanOrEqual(frozen); // no jump to 0 or 1
    expect(audio.volume).toBeLessThan(frozen + 0.1);
    await vi.advanceTimersByTimeAsync(500);
    expect(await back).toBe(true);
    expect(audio.volume).toBe(1);
  });

  it("a newer fade supersedes the running one", async () => {
    const first = engine.fadeOut(1000);
    await vi.advanceTimersByTimeAsync(100);
    const second = engine.fadeIn(100);
    expect(await first).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await second).toBe(true);
  });

  it("the player's volume sits on top of the fades and is never overridden by them", async () => {
    engine.setMasterVolume(0.5);
    expect(audio.volume).toBeCloseTo(0.5);
    const out = engine.fadeOut(200);
    await vi.advanceTimersByTimeAsync(100);
    expect(audio.volume).toBeLessThan(0.5);
    await vi.advanceTimersByTimeAsync(200);
    await out;
    expect(audio.volume).toBe(0);
    expect(engine.getMasterVolume()).toBe(0.5);
    const inn = engine.fadeIn(200);
    await vi.advanceTimersByTimeAsync(300);
    await inn;
    expect(audio.volume).toBeCloseTo(0.5); // back to the player's level, not to full volume
  });

  it("setVolume cancels a fade and jumps to the value; bad master values are clamped", () => {
    void engine.fadeOut(1000);
    engine.setVolume(0.25);
    expect(audio.volume).toBeCloseTo(0.25);
    engine.setMasterVolume(7);
    expect(engine.getMasterVolume()).toBe(1);
    engine.setMasterVolume(Number.NaN);
    expect(engine.getMasterVolume()).toBe(1);
    engine.setMasterVolume(-1);
    expect(engine.getMasterVolume()).toBe(0);
  });

  it("zero-length and no-op fades resolve at once", async () => {
    expect(await engine.fadeIn(400)).toBe(true); // already at 1
    expect(await engine.fadeOut(0)).toBe(true);
    expect(audio.volume).toBe(0);
  });

  it("passes play, pause and seek through and reports state changes", async () => {
    const states: string[] = [];
    engine.onStateChange((s) => states.push(s));
    await engine.play();
    engine.pause();
    expect(states).toEqual(["playing", "paused"]);
    const seeking = engine.seek(42);
    audio.dispatchEvent(new Event("seeked"));
    await seeking;
    expect(audio.currentTime).toBe(42);
    expect(engine.getCurrentTime()).toBe(42);
    expect(engine.getDuration()).toBe(100);
  });

  it("reports element errors", () => {
    const errors: string[] = [];
    engine.onError((m) => errors.push(m));
    audio.error = { message: "MEDIA_ERR_SRC_NOT_SUPPORTED" };
    audio.dispatchEvent(new Event("error"));
    expect(errors).toEqual(["MEDIA_ERR_SRC_NOT_SUPPORTED"]);
  });

  it("estimates the output level from the volume stages", async () => {
    expect(engine.getOutputLevel()).toBe(0); // paused
    await engine.play();
    engine.setMasterVolume(0.4);
    expect(engine.getOutputLevel()).toBeCloseTo(0.4);
  });
});
