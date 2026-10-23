// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExitTransition } from "./useExitTransition";

afterEach(() => vi.useRealTimers());

describe("useExitTransition", () => {
  it("paints closed first, then opens; stays mounted while it rolls away", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => useExitTransition(open, 220), { initialProps: { open: false } });
    expect(result.current).toEqual({ mounted: false, state: "closed" });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: "closed" });
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.state).toBe("open");
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: "closed" });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.mounted).toBe(false);
  });
});
