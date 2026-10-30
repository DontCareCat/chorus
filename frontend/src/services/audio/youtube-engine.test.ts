import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YT_STATE, YouTubePlaybackEngine, youtubeErrorMessage } from "./youtube-engine";
import type { YtPlayerLike } from "./youtube-engine";

/** A stand-in for the IFrame player: seeks land after a delay, the position is whatever the test sets. */
class FakePlayer implements YtPlayerLike {
  time = 0;
  state: number = YT_STATE.cued;
  volume = 100;
  duration = 200;
  destroyed = false;
  seeks: number[] = [];
  onState: (code: number) => void = () => {};
  playVideo() { this.state = YT_STATE.playing; this.onState(this.state); }
  pauseVideo() { this.state = YT_STATE.paused; this.onState(this.state); }
  seekTo(s: number) { this.seeks.push(s); this.state = YT_STATE.buffering; this.onState(this.state); setTimeout(() => { this.time = s; this.state = YT_STATE.playing; this.onState(this.state); }, 300); }
  getCurrentTime() { return this.time; }
  getDuration() { return this.duration; }
  getPlayerState() { return this.state; }
  getPlaybackRate() { return 1; }
  setVolume(v: number) { this.volume = v; }
  destroy() { this.destroyed = true; }
}

let player: FakePlayer;
let engine: YouTubePlaybackEngine;
beforeEach(() => {
  vi.useFakeTimers();
  player = new FakePlayer();
  engine = new YouTubePlaybackEngine(player);
  player.onState = (c) => engine.handleState(c);
});
afterEach(() => vi.useRealTimers());

describe("YouTubePlaybackEngine", () => {
  it("plays once the player says it is playing, and maps the states", async () => {
    const states: string[] = [];
    engine.onStateChange((s) => states.push(s));
    await engine.play();
    engine.handleState(YT_STATE.buffering);
    engine.handleState(YT_STATE.playing);
    engine.pause();
    engine.handleState(YT_STATE.ended);
    expect(states).toEqual(["playing", "buffering", "playing", "paused", "ended"]);
  });

  it("rejects play when the player never starts (blocked autoplay)", async () => {
    player.playVideo = () => {};
    const caught = engine.play().catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(10_500);
    expect(await caught).toBe("play timed out");
  });

  it("interpolates between the player's coarse reads and never goes backwards", async () => {
    await engine.play();
    player.time = 10;
    expect(engine.getCurrentTime()).toBe(10);
    vi.advanceTimersByTime(100);
    const mid = engine.getCurrentTime();
    expect(mid).toBeGreaterThan(10.05);
    player.time = 10.04; // the player's own (stale) value lags behind the interpolation
    expect(engine.getCurrentTime()).toBeGreaterThanOrEqual(mid);
  });

  it("stands still while buffering (an ad or a stall), and starts again afterwards", async () => {
    await engine.play();
    player.time = 20;
    engine.getCurrentTime();
    engine.handleState(YT_STATE.buffering);
    const frozen = engine.getCurrentTime();
    vi.advanceTimersByTime(3000);
    expect(engine.getCurrentTime()).toBe(frozen);
    engine.handleState(YT_STATE.playing);
    vi.advanceTimersByTime(500);
    expect(engine.getCurrentTime()).toBeGreaterThan(frozen + 0.4);
  });

  it("seeks: resolves when the player is there and playing, and follows a jump back", async () => {
    await engine.play();
    player.time = 50;
    engine.getCurrentTime();
    const done = engine.seek(30);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(player.seeks).toEqual([30]);
    player.time = 30.1;
    expect(engine.getCurrentTime()).toBeCloseTo(30.1, 1);
  });

  it("a seek that never arrives is an error", async () => {
    await engine.play();
    player.seekTo = () => { player.state = YT_STATE.buffering; };
    const caught = engine.seek(10).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(12_500);
    expect(await caught).toContain("timed out");
  });

  it("fades the player's volume in steps, under the master volume", async () => {
    engine.setMasterVolume(0.5);
    expect(player.volume).toBe(50);
    const out = engine.fadeOut(1000);
    await vi.advanceTimersByTimeAsync(500);
    expect(player.volume).toBeLessThan(30);
    expect(player.volume).toBeGreaterThan(15);
    await vi.advanceTimersByTimeAsync(600);
    expect(await out).toBe(true);
    expect(player.volume).toBe(0);
    const back = engine.fadeIn(200);
    engine.cancelFade();
    expect(await back).toBe(false);
  });

  it("reports errors in words and cleans up", () => {
    const msgs: string[] = [];
    engine.onError((m) => msgs.push(m));
    engine.handleError(150);
    expect(msgs[0]).toContain("does not allow");
    expect(youtubeErrorMessage(100)).toContain("removed or is private");
    engine.dispose();
    expect(player.destroyed).toBe(true);
  });

  it("knows the length only once the player does", () => {
    player.duration = 0;
    expect(Number.isNaN(engine.getDuration())).toBe(true);
    player.duration = 213;
    expect(engine.getDuration()).toBe(213);
  });
});
