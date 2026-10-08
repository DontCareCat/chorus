// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { FakePlaybackEngine } from "../game/testing/fake-engine";
import { VOLUME_STORAGE_KEY } from "../game/volume";
import { useVolume } from "./useVolume";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => localStorage.clear());

describe("useVolume", () => {
  it("starts at full volume and applies the setting to the engine as soon as it exists", () => {
    const { result, rerender } = renderHook(({ e }) => useVolume(e), { initialProps: { e: null as FakePlaybackEngine | null } });
    expect(result.current.volume).toBe(1);
    act(() => result.current.setVolume(0.4)); // moved before the first play: no engine yet
    const engine = new FakePlaybackEngine();
    rerender({ e: engine });
    expect(engine.masterVolume).toBe(0.4);
  });

  it("setting the volume applies it, and unmutes", () => {
    const engine = new FakePlaybackEngine();
    const { result } = renderHook(() => useVolume(engine));
    act(() => result.current.toggleMute());
    expect(engine.masterVolume).toBe(0);
    act(() => result.current.setVolume(0.7));
    expect(engine.masterVolume).toBe(0.7);
    expect(result.current.muted).toBe(false);
  });

  it("mute is silent but remembers the level; unmute restores it", () => {
    const engine = new FakePlaybackEngine();
    const { result } = renderHook(() => useVolume(engine));
    act(() => result.current.setVolume(0.6));
    act(() => result.current.toggleMute());
    expect(engine.masterVolume).toBe(0);
    expect(result.current.volume).toBe(0.6);
    act(() => result.current.toggleMute());
    expect(engine.masterVolume).toBe(0.6);
  });

  it("keyboard steps move 5 % and unmute (from a muted state they start from 0)", () => {
    const engine = new FakePlaybackEngine();
    const { result } = renderHook(() => useVolume(engine));
    act(() => result.current.setVolume(0.5));
    act(() => result.current.step(1));
    expect(engine.masterVolume).toBe(0.55);
    act(() => result.current.step(-1));
    act(() => result.current.step(-1));
    expect(engine.masterVolume).toBe(0.45);
    act(() => result.current.toggleMute());
    act(() => result.current.step(1));
    expect(result.current.muted).toBe(false);
    expect(engine.masterVolume).toBe(0.05);
  });

  it("is remembered between visits", () => {
    const first = renderHook(() => useVolume(null));
    act(() => first.result.current.setVolume(0.25));
    first.unmount();
    const again = renderHook(() => useVolume(null));
    expect(again.result.current.volume).toBe(0.25);
    expect(JSON.parse(localStorage.getItem(VOLUME_STORAGE_KEY)!)).toEqual({ volume: 0.25, muted: false });
  });

  it("ignores a corrupt saved value", () => {
    localStorage.setItem(VOLUME_STORAGE_KEY, "{{{");
    expect(renderHook(() => useVolume(null)).result.current).toMatchObject({ volume: 1, muted: false });
  });

  it("keeps working when storage is blocked", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const engine = new FakePlaybackEngine();
      const { result } = renderHook(() => useVolume(engine));
      act(() => result.current.setVolume(0.2));
      expect(engine.masterVolume).toBe(0.2);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
