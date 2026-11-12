// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, useLongPress } from "./useLongPress";

const ev = (x = 0, y = 0, pointerType = "touch") => ({ clientX: x, clientY: y, pointerType }) as never;

describe("useLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires after the hold time and swallows the click that ends it", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS - 1); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(40); }); // the hold is decided one frame after the timer
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.consumeClick()).toBe(true);
    expect(result.current.consumeClick()).toBe(false);
  });
  it("a short tap does nothing", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => result.current.handlers.onPointerUp());
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(false);
  });
  it("moving more than 8 px (a scroll) cancels it", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev(10, 10)));
    act(() => result.current.handlers.onPointerMove(ev(10, 30)));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
  });
  it("a scroll that arrives after the timer but before the frame (a busy page) cancels it", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); }); // the timer ran; the finger's queued scroll has not been handled yet
    act(() => { document.dispatchEvent(new Event("scroll")); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.consumeClick()).toBe(false);
  });
  it("a scroll of the list during the hold cancels it, and a later press still works", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(100); });
    const list = document.createElement("ul");
    document.body.append(list);
    act(() => { list.dispatchEvent(new Event("scroll")); }); // scroll does not bubble: the listener captures it
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 40); });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { document.dispatchEvent(new Event("scroll")); }); // the listener went away with the press
    expect(result.current.consumeClick()).toBe(true);
  });
  it("lifted in the frame the hold is decided in still counts as a hold", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev()));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    act(() => result.current.handlers.onPointerUp());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.consumeClick()).toBe(true);
  });
  it("ignores the mouse", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev(0, 0, "mouse")));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
  });
});
