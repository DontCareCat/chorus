// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Transport } from "./Transport";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const volume = { level: 1, muted: false, set: () => undefined, toggleMute: () => undefined, step: () => undefined };
const runway = { playheadPct: 0, ticks: [], deadlinePct: null, slack: null, ahead: null } as never;
const base = {
  engineReady: true, state: "PAUSED" as const, time: 5, duration: 222, onStart: () => undefined, onPlay: () => undefined, onPause: () => undefined,
  onBack: () => undefined, onSeek: () => Promise.resolve(), runway, ticks: [], gated: false, focusedId: null, onFocus: () => undefined, volume,
};

/** A finger drag across the bar, as the browser reports it (jsdom has no touch pointer events of its own). */
let clock = 0;
const swipe = (el: Element, from: number, to: number) => {
  const ev = (type: string, x: number) => {
    const e = new Event(type, { bubbles: true });
    for (const [k, v] of Object.entries({ pointerType: "touch", pointerId: 1, clientX: x, clientY: 10, timeStamp: (clock += 40) })) Object.defineProperty(e, k, { value: v });
    fireEvent(type === "pointerdown" ? el : window, e);
  };
  ev("pointerdown", from); ev("pointermove", (from + to) / 2); ev("pointermove", to); ev("pointerup", to);
};

describe("Transport", () => {
  it("has no Stop button on any screen", () => {
    const { rerender } = render(<Transport {...base} phone={false} onNext={() => undefined} queue={{ count: 2, onOpen: () => undefined }} />);
    expect(screen.queryByLabelText("Stop")).toBeNull();
    rerender(<Transport {...base} phone onNext={() => undefined} queue={{ count: 2, onOpen: () => undefined }} />);
    expect(screen.queryByLabelText("Stop")).toBeNull();
  });
  it("a phone has neither a Next button nor a volume control; a wide screen has both", () => {
    const { rerender } = render(<Transport {...base} phone onNext={() => undefined} queue={{ count: 2, onOpen: () => undefined }} />);
    expect(screen.queryByLabelText("Skip to next")).toBeNull();
    expect(screen.queryByLabelText("Volume")).toBeNull();
    rerender(<Transport {...base} phone={false} onNext={() => undefined} queue={{ count: 2, onOpen: () => undefined }} />);
    expect(screen.getByLabelText("Skip to next")).toBeTruthy();
    expect(screen.getAllByLabelText("Volume").length).toBeGreaterThan(0);
  });
  it("the wide Next button is Next, and is off while the queue is empty", () => {
    const next = vi.fn();
    const { rerender } = render(<Transport {...base} phone={false} onNext={next} queue={{ count: 0, onOpen: () => undefined }} />);
    expect((screen.getByLabelText("Skip to next") as HTMLButtonElement).disabled).toBe(true);
    rerender(<Transport {...base} phone={false} onNext={next} queue={{ count: 1, onOpen: () => undefined }} />);
    fireEvent.click(screen.getByLabelText("Skip to next"));
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("shows the song's length only (no elapsed time)", () => {
    const { container } = render(<Transport {...base} phone onNext={() => undefined} queue={{ count: 1, onOpen: () => undefined }} />);
    expect([...container.querySelectorAll(".transport-time")].map((e) => e.textContent)).toEqual(["3:42"]);
  });
  it("a left swipe on the phone bar is Next, a right swipe is not", () => {
    const next = vi.fn();
    const { container } = render(<Transport {...base} phone onNext={next} queue={{ count: 1, onOpen: () => undefined }} />);
    const bar = container.querySelector(".transport")!;
    swipe(bar, 300, 280); // too short
    swipe(bar, 100, 300); // the wrong way
    expect(next).not.toHaveBeenCalled();
    swipe(bar, 300, 100);
    expect(next).toHaveBeenCalledTimes(1);
  });
  it("a swipe that starts on the progress track is a seek, not Next", () => {
    const next = vi.fn();
    const { container } = render(<Transport {...base} phone onNext={next} queue={{ count: 1, onOpen: () => undefined }} />);
    swipe(container.querySelector(".seek")!, 300, 100);
    expect(next).not.toHaveBeenCalled();
  });
  it("does not swipe when nothing waits in the queue, and then shows no hint", () => {
    const next = vi.fn();
    const { container } = render(<Transport {...base} phone onNext={next} queue={{ count: 0, onOpen: () => undefined }} />);
    swipe(container.querySelector(".transport")!, 300, 100);
    expect(next).not.toHaveBeenCalled();
    expect(container.querySelector(".swipe-hint")?.getAttribute("data-shown")).toBe("false");
  });
  it("the hint shows on the first game screens and is gone for good after a swipe", () => {
    const props = { ...base, phone: true, queue: { count: 1, onOpen: () => undefined } };
    const first = render(<Transport {...props} onNext={() => undefined} />);
    expect(first.container.querySelector(".swipe-hint")?.getAttribute("data-shown")).toBe("true");
    swipe(first.container.querySelector(".transport")!, 300, 100);
    expect(first.container.querySelector(".swipe-hint")?.getAttribute("data-shown")).toBe("false");
    first.unmount();
    const later = render(<Transport {...props} onNext={() => undefined} />);
    expect(later.container.querySelector(".swipe-hint")?.getAttribute("data-shown")).toBe("false");
  });
});
