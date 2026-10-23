// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dragOutcome, Sheet } from "./Sheet";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("dragOutcome", () => {
  it("is a tap below 6 px", () => expect(dragOutcome(3, 400, 0)).toBe("tap"));
  it("closes past 30% of the height", () => expect(dragOutcome(130, 400, 0.1)).toBe("close"));
  it("closes on a flick even when short", () => expect(dragOutcome(40, 400, 0.8)).toBe("close"));
  it("springs back for a short, slow drag", () => expect(dragOutcome(60, 400, 0.1)).toBe("back"));
});

const pointer = (type: string, y: number, t: number) => ({ clientY: y, pointerId: 1, timeStamp: t, type });

describe("Sheet", () => {
  it("rolls up after mount and rolls away (then calls onClose) on a tap on the backdrop", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const { container } = render(<Sheet label="Menu" onClose={close}><p>hello</p></Sheet>);
    const sheet = container.querySelector(".sheet")!;
    expect(sheet.getAttribute("data-state")).toBe("enter");
    act(() => { vi.advanceTimersByTime(50); });
    expect(sheet.getAttribute("data-state")).toBe("open");
    fireEvent.click(container.querySelector(".sheet-scrim")!);
    expect(sheet.getAttribute("data-state")).toBe("closing");
    expect(close).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("does not close when the sheet itself is tapped", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Sheet label="Menu" onClose={close}><p>hello</p></Sheet>);
    fireEvent.click(screen.getByText("hello"));
    act(() => { vi.advanceTimersByTime(400); });
    expect(close).not.toHaveBeenCalled();
  });
  it("closes on a tap on the handle", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<Sheet label="Menu" onClose={close}><p>x</p></Sheet>);
    const grab = screen.getByRole("button", { name: "Close" });
    fireEvent.pointerDown(grab, pointer("pointerdown", 300, 0));
    fireEvent.pointerUp(grab, pointer("pointerup", 301, 50));
    act(() => { vi.advanceTimersByTime(300); });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("follows the finger, and a short slow drag springs back without closing", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const { container } = render(<Sheet label="Menu" onClose={close}><p>x</p></Sheet>);
    const grab = screen.getByRole("button", { name: "Close" });
    const sheet = container.querySelector<HTMLElement>(".sheet")!;
    Object.defineProperty(sheet, "offsetHeight", { value: 400 }); // jsdom has no layout
    fireEvent.pointerDown(grab, pointer("pointerdown", 300, 0));
    fireEvent.pointerMove(grab, pointer("pointermove", 340, 400));
    expect(sheet.style.transform).toBe("translateY(40px)");
    expect(sheet.hasAttribute("data-dragging")).toBe(true);
    fireEvent.pointerUp(grab, pointer("pointerup", 340, 800));
    expect(sheet.style.transform).toBe(""); // springs back
    act(() => { vi.advanceTimersByTime(500); });
    expect(close).not.toHaveBeenCalled();
  });
  it("a drag past 30% of its height closes it", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const { container } = render(<Sheet label="Menu" onClose={close}><p>x</p></Sheet>);
    Object.defineProperty(container.querySelector(".sheet")!, "offsetHeight", { value: 400 });
    const grab = screen.getByRole("button", { name: "Close" });
    fireEvent.pointerDown(grab, pointer("pointerdown", 300, 0));
    fireEvent.pointerMove(grab, pointer("pointermove", 450, 600));
    fireEvent.pointerUp(grab, pointer("pointerup", 450, 900));
    act(() => { vi.advanceTimersByTime(300); });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
