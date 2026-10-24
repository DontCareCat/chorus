// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "./useSelection";

describe("useSelection", () => {
  it("stays in select mode until it is cancelled, even when the last tick is removed", () => {
    const { result } = renderHook(() => useSelection());
    expect(result.current.active).toBe(false);
    act(() => result.current.toggle(3));
    expect(result.current.active).toBe(true);
    expect(result.current.has(3)).toBe(true);
    act(() => result.current.toggle(3));
    expect(result.current.picked.size).toBe(0);
    expect(result.current.active).toBe(true);
    act(() => result.current.clear());
    expect(result.current.active).toBe(false);
  });
  it("selects everything it is given and clears", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectAll([1, 2, 3]));
    expect(result.current.picked.size).toBe(3);
    act(() => result.current.clear());
    expect(result.current.picked.size).toBe(0);
  });
  it("forgets songs that left the list", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.selectAll([1, 2, 3]));
    act(() => result.current.keepOnly(new Set([2, 3, 9])));
    expect([...result.current.picked]).toEqual([2, 3]);
  });
});
