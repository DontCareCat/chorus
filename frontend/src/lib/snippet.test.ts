import { describe, expect, it, vi } from "vitest";
import { SnippetPlayer, type AudioLike } from "./snippet";

class FakeAudio implements AudioLike {
  src = "";
  currentTime = 0;
  paused = true;
  fail = false;
  handlers: Record<string, () => void> = {};
  async play() {
    if (this.fail) throw new Error("blocked");
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, fn: () => void) {
    this.handlers[type] = fn;
  }
}

const url = (id: number) => `/api/songs/${id}/audio`;

function setup() {
  vi.useFakeTimers();
  const audio = new FakeAudio();
  const player = new SnippetPlayer(audio, url, 30);
  const changes: Array<string | null> = [];
  player.onChange((k) => changes.push(k));
  return { audio, player, changes };
}

describe("SnippetPlayer", () => {
  it("plays from the start of the line and stops at its end", async () => {
    const { audio, player, changes } = setup();
    await player.toggle("a", { songId: 1, start: 10, end: 12 });
    expect(audio.src).toBe(url(1));
    expect(audio.currentTime).toBe(10);
    expect(audio.paused).toBe(false);
    audio.currentTime = 11.9;
    vi.advanceTimersByTime(30);
    expect(audio.paused).toBe(false);
    audio.currentTime = 12.02;
    vi.advanceTimersByTime(30);
    expect(audio.paused).toBe(true);
    expect(changes).toEqual(["a", null]);
    vi.useRealTimers();
  });

  it("a second tap on the playing sentence stops it", async () => {
    const { audio, player } = setup();
    await player.toggle("a", { songId: 1, start: 0, end: 5 });
    await player.toggle("a", { songId: 1, start: 0, end: 5 });
    expect(audio.paused).toBe(true);
    expect(player.playing).toBeNull();
    vi.useRealTimers();
  });

  it("only one sentence plays at a time, and the file is loaded once per song", async () => {
    const { audio, player, changes } = setup();
    await player.toggle("a", { songId: 1, start: 0, end: 5 });
    audio.src = "kept";
    await player.toggle("b", { songId: 1, start: 20, end: 25 });
    expect(audio.src).toBe("kept");
    expect(audio.currentTime).toBe(20);
    expect(changes).toEqual(["a", null, "b"]);
    await player.toggle("c", { songId: 2, start: 1, end: 2 });
    expect(audio.src).toBe(url(2));
    vi.useRealTimers();
  });

  it("reports a blocked play and ends in the stopped state", async () => {
    const { audio, player } = setup();
    audio.fail = true;
    expect(await player.toggle("a", { songId: 1, start: 0, end: 5 })).toBe(false);
    expect(player.playing).toBeNull();
    vi.useRealTimers();
  });

  it("stops when the file ends or fails", async () => {
    const { audio, player } = setup();
    await player.toggle("a", { songId: 1, start: 0, end: 500 });
    audio.handlers["ended"]!();
    expect(player.playing).toBeNull();
    await player.toggle("a", { songId: 1, start: 0, end: 500 });
    audio.handlers["error"]!();
    expect(player.playing).toBeNull();
    vi.useRealTimers();
  });
});
