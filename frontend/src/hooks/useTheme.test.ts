// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it("follows the system until a choice is made", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("remembers light and dark, and System forgets the choice", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("chorus-theme")).toBe("dark");
    expect(renderHook(() => useTheme()).result.current.theme).toBe("dark");
    act(() => result.current.setTheme("system"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("chorus-theme")).toBeNull();
  });
});
