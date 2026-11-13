// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transport } from "./Transport";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const volume = { level: 1, muted: false, set: () => undefined, toggleMute: () => undefined, step: () => undefined };
const base = {
  engineReady: true, state: "PAUSED" as const, getTime: () => 5, duration: 222, onStart: () => undefined, onPlay: () => undefined, onPause: () => undefined,
  lines: [], peaks: null, limit: 222, onScrubStart: () => ({ wasPlaying: false }), onScrubEnd: () => Promise.resolve(), onGate: () => undefined, volume,
};
const queue = { count: 2, onOpen: () => undefined };

describe("Transport", () => {
  it("is one row: play, the strip, the time left, the queue (and the volume on a wide screen)", () => {
    const { container } = render(<Transport {...base} phone={false} queue={queue} />);
    const kids = [...container.querySelector(".transport-inner")!.children].map((c) => c.className.split(" ").find((n) => ["controls", "strip", "transport-time", "volume", "queue-btn"].includes(n)));
    expect(kids).toEqual(["controls", "strip", "transport-time", "volume", "queue-btn"]);
  });
  it("has no Stop, rewind, Next or swipe hint on any screen, and no seek input", () => {
    const { container, rerender } = render(<Transport {...base} phone={false} queue={queue} />);
    for (const phone of [false, true]) {
      rerender(<Transport {...base} phone={phone} queue={queue} />);
      expect(screen.queryByLabelText("Stop")).toBeNull();
      expect(screen.queryByLabelText(/Back 5/)).toBeNull();
      expect(screen.queryByLabelText("Skip to next")).toBeNull();
      expect(container.querySelector(".swipe-hint, .swipe-reveal, input.seek")).toBeNull();
    }
  });
  it("a phone has no volume control; a wide screen has one", () => {
    const { rerender } = render(<Transport {...base} phone queue={queue} />);
    expect(screen.queryByLabelText("Volume")).toBeNull();
    rerender(<Transport {...base} phone={false} queue={queue} />);
    expect(screen.getAllByLabelText("Volume").length).toBeGreaterThan(0);
  });
  it("shows the time left as -m:ss and never the total", () => {
    const { container } = render(<Transport {...base} phone queue={queue} />);
    expect(container.querySelector(".transport-time")!.textContent).toBe("-3:37");
  });
  it("the strip is a slider with its position in words", () => {
    render(<Transport {...base} phone queue={queue} />);
    const s = screen.getByRole("slider");
    expect(s.getAttribute("aria-valuetext")).toBe("0:05 of 3:42, 3:37 left");
    expect(s.getAttribute("aria-valuemax")).toBe("222");
    expect(s.tabIndex).toBe(0);
  });
  it("arrow keys on the strip scrub ±5 s once (and do not reach the game's own handler); Home and End jump", () => {
    vi.useFakeTimers();
    const ends: number[] = [];
    const onScrubEnd = (t: number) => { ends.push(t); return Promise.resolve(); };
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    render(<Transport {...base} phone queue={queue} onScrubEnd={onScrubEnd} />);
    const s = screen.getByRole("slider");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    fireEvent.keyDown(s, { key: "ArrowRight" });
    vi.advanceTimersByTime(300);
    expect(ends).toEqual([15]);
    fireEvent.keyDown(s, { key: "End" });
    vi.advanceTimersByTime(300);
    expect(ends.at(-1)).toBe(222);
    fireEvent.keyDown(s, { key: "Home" });
    vi.advanceTimersByTime(300);
    expect(ends.at(-1)).toBe(0);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener("keydown", outer);
    vi.useRealTimers();
  });
  it("the strip is off until the audio exists", () => {
    render(<Transport {...base} engineReady={false} phone queue={queue} />);
    const s = screen.getByRole("slider");
    expect(s.getAttribute("aria-disabled")).toBe("true");
    expect(s.tabIndex).toBe(-1);
  });
  it("play starts the engine first, then plays and pauses", () => {
    const onStart = vi.fn(), onPlay = vi.fn(), onPause = vi.fn();
    const { rerender } = render(<Transport {...base} engineReady={false} onStart={onStart} onPlay={onPlay} onPause={onPause} phone queue={queue} />);
    fireEvent.click(screen.getByLabelText("Play"));
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<Transport {...base} onStart={onStart} onPlay={onPlay} onPause={onPause} phone queue={queue} />);
    fireEvent.click(screen.getByLabelText("Play"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    rerender(<Transport {...base} state="PLAYING" onStart={onStart} onPlay={onPlay} onPause={onPause} phone queue={queue} />);
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(onPause).toHaveBeenCalledTimes(1);
  });
});
