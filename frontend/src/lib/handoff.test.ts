// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceArrival, clearArrival, fadeOutAndRelease, peekArrival } from "./handoff";
import type { GameEngine } from "../services/audio/engine";

afterEach(() => { clearArrival(); vi.useRealTimers(); });

describe("arrival", () => {
  it("is seen until it is cleared, and expires", () => {
    vi.useFakeTimers();
    expect(peekArrival()).toBeNull();
    announceArrival({ fadeMs: 4000, autostart: true });
    expect(peekArrival()).toMatchObject({ fadeMs: 4000, autostart: true });
    expect(peekArrival()).not.toBeNull(); // twice: React renders twice in development
    clearArrival();
    expect(peekArrival()).toBeNull();
    announceArrival({ fadeMs: 0, autostart: true });
    vi.advanceTimersByTime(21_000);
    expect(peekArrival()).toBeNull();
  });
});

describe("fadeOutAndRelease", () => {
  const make = (fade: Promise<boolean>) => {
    const engine = { fadeOut: vi.fn(() => fade), dispose: vi.fn() } as unknown as GameEngine;
    const audio = document.createElement("audio");
    document.body.appendChild(audio);
    return { engine, audio };
  };
  it("fades, then disposes and removes the element", async () => {
    const { engine, audio } = make(Promise.resolve(true));
    fadeOutAndRelease(engine, audio, 3000);
    expect(engine.fadeOut).toHaveBeenCalledWith(3000);
    await Promise.resolve(); await Promise.resolve();
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(audio.isConnected).toBe(false);
  });
  it("still lets go when the fade never reports back", () => {
    vi.useFakeTimers();
    const { engine, audio } = make(new Promise<boolean>(() => undefined));
    fadeOutAndRelease(engine, audio, 2000);
    expect(audio.isConnected).toBe(true);
    vi.advanceTimersByTime(3600);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(audio.isConnected).toBe(false);
  });
});
