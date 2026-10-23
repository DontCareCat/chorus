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
    act(() => { vi.advanceTimersByTime(2); });
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
  it("ignores the mouse", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress: fn }));
    act(() => result.current.handlers.onPointerDown(ev(0, 0, "mouse")));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
  });
});
