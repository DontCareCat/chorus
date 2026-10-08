// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePlaybackEngine } from "../game/testing/fake-engine";
import type { SyncQuestion } from "../game/synchronization";
import { usePlaybackSync } from "./usePlaybackSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Q19: SyncQuestion = { id: 19, sequence: 19, startTime: 49, endTime: 52.1, recoveryTime: 45.3 };
const NO_ANSWERS: ReadonlySet<number> = new Set();

let engine: FakePlaybackEngine;
beforeEach(() => {
  vi.useFakeTimers();
  engine = new FakePlaybackEngine();
});
afterEach(() => vi.useRealTimers());

const settle = async (ms = 0) => {
  await act(async () => {
    engine.advance(ms);
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function mount(over: Partial<Parameters<typeof usePlaybackSync>[0]> = {}) {
  return renderHook(() =>
    usePlaybackSync({ engine, questions: [Q19], answered: NO_ANSWERS, gating: true, pollMs: 100, ...over }),
  );
}

describe("usePlaybackSync", () => {
  it("polls the engine and recovers when the audio overruns", async () => {
    const { result } = mount();
    await act(async () => result.current.play());
    expect(result.current.state.name).toBe("PLAYING");
    engine.time = 55.5;
    await settle(150);
    expect(result.current.state.name).toBe("FADING_OUT");
    await settle(500);
    await settle(0);
    expect(result.current.state.name).toBe("PAUSED_FOR_QUESTION");
    expect(engine.time).toBe(45.3);
  });

  it("markAnswered is optimistic and resumes immediately, with no network involved", async () => {
    const { result } = mount();
    await act(async () => result.current.play());
    engine.time = 55.5;
    await settle(150);
    await settle(600);
    expect(result.current.state.name).toBe("PAUSED_FOR_QUESTION");
    await act(async () => result.current.markAnswered(19));
    expect(result.current.state.name).toBe("FADING_IN");
    await settle(600);
    expect(result.current.state.name).toBe("PLAYING");
  });

  it("an already-answered (persisted) question never blocks", async () => {
    const { result } = mount({ answered: new Set([19]) });
    await act(async () => result.current.play());
    engine.time = 80;
    await settle(300);
    expect(result.current.state.name).toBe("PLAYING");
  });

  it("the engine's 'ended' event with an unanswered question triggers recovery", async () => {
    engine.duration = 53;
    const { result } = mount();
    engine.time = 52.5;
    await act(async () => result.current.play());
    await settle(1000); // plays to the end → fake engine emits 'ended'
    await settle(0);
    expect(engine.time).toBe(45.3);
    expect(result.current.state.name).toBe("PAUSED_FOR_QUESTION");
  });

  it("free play (gating off) never recovers", async () => {
    engine.duration = 1000;
    const { result } = mount({ gating: false, questions: [] });
    await act(async () => result.current.play());
    engine.time = 500;
    await settle(500);
    expect(result.current.state.name).toBe("PLAYING");
  });

  it("stops polling and pauses the engine on unmount", async () => {
    const { result, unmount } = mount();
    await act(async () => result.current.play());
    unmount();
    engine.time = 80;
    await settle(500);
    expect(engine.playing).toBe(false);
    expect(engine.count("fadeOut")).toBe(0);
  });
});
