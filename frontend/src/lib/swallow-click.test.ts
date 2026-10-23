// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { swallowNextClick } from "./swallow-click";

afterEach(() => vi.useRealTimers());

describe("swallowNextClick", () => {
  it("stops exactly the next click from reaching the page", () => {
    const hit = vi.fn();
    const el = document.createElement("button");
    el.addEventListener("click", hit);
    document.body.append(el);
    swallowNextClick();
    el.click();
    expect(hit).not.toHaveBeenCalled();
    el.click();
    expect(hit).toHaveBeenCalledTimes(1);
  });
  it("lets later clicks through when no click came (a scroll)", () => {
    vi.useFakeTimers();
    const hit = vi.fn();
    const el = document.createElement("button");
    el.addEventListener("click", hit);
    document.body.append(el);
    swallowNextClick(300);
    vi.advanceTimersByTime(400);
    el.click();
    expect(hit).toHaveBeenCalledTimes(1);
  });
});
