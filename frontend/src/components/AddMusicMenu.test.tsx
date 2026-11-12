// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddMusicMenu, POPOVER_MS } from "./AddMusicMenu";
import type { AddMusicItem } from "./AddMusicMenu";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const upload = vi.fn();
const items: AddMusicItem[] = [
  { id: "link", icon: "link", label: "Paste a YouTube link", step: "link" },
  { id: "files", icon: "uploadFile", label: "Upload files", onPick: upload },
  { kind: "divider" },
  { id: "lyrics", icon: "lyrics", label: "Find missing lyrics", right: "3" },
];
const steps = { link: { title: "Paste a YouTube link", body: <label>Video or playlist link<input /></label> } };
const anchor = createRef<HTMLElement>();
const ui = (p: { phone: boolean; open: boolean; onClose?: () => void; startStep?: string | null }) => <AddMusicMenu phone={p.phone} open={p.open} onClose={p.onClose ?? (() => undefined)} anchor={anchor} items={items} steps={steps} startStep={p.startStep} footer="Or drop files anywhere on this page." />;

describe("AddMusicMenu on a phone", () => {
  it("is a sheet with the title, the help line, the rows and a chevron on rows that open a second step", () => {
    render(ui({ phone: true, open: true }));
    expect(document.querySelector(".sheet-scrim .sheet.add-sheet .grab")).not.toBeNull();
    expect(document.querySelector(".sheet-head")!.textContent).toContain("Add music");
    expect(document.querySelector(".sheet-head")!.textContent).toContain("Songs go to your library. Lyrics are looked up by themselves.");
    expect(screen.getAllByRole("menuitem").map((e) => e.textContent)).toEqual(["Paste a YouTube link", "Upload files", "Find missing lyrics3"]);
    expect(screen.getByRole("menuitem", { name: "Paste a YouTube link" }).querySelector(".mi-more")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Upload files" }).querySelector(".mi-more")).toBeNull();
    expect(document.querySelector(".add-foot")).toBeNull(); // the drop hint is for a PC
  });
  it("opens the second step in the same sheet and goes back", () => {
    render(ui({ phone: true, open: true }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste a YouTube link" }));
    expect(screen.getByLabelText("Video or playlist link")).not.toBeNull();
    expect(document.querySelectorAll(".sheet").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getAllByRole("menuitem").length).toBe(3);
  });
  it("a row that acts does it and rolls the sheet away", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(ui({ phone: true, open: true, onClose: close }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Upload files" }));
    expect(upload).toHaveBeenCalled();
    expect(document.querySelector(".sheet")!.getAttribute("data-state")).toBe("closing");
    act(() => { vi.advanceTimersByTime(300); });
    expect(close).toHaveBeenCalled();
  });
});

describe("AddMusicMenu opened on a step", () => {
  it("opens straight on the link step (a link shared from another app) and starts at the menu again next time", () => {
    const { rerender } = render(ui({ phone: true, open: true, startStep: "link" }));
    expect(screen.getByLabelText("Video or playlist link")).not.toBeNull();
    rerender(ui({ phone: true, open: false, startStep: null }));
    rerender(ui({ phone: true, open: true, startStep: null }));
    expect(screen.getAllByRole("menuitem").length).toBe(3);
  });
});

describe("AddMusicMenu on a PC", () => {
  it("is a popover with the rows, the count on the right and the drop hint at the foot", () => {
    render(ui({ phone: false, open: true }));
    expect(document.querySelector(".add-popover.song-menu")).not.toBeNull();
    expect(document.querySelector(".sheet")).toBeNull();
    expect(document.querySelector(".mi-right")!.textContent).toBe("3");
    expect(document.querySelector(".add-foot")!.textContent).toBe("Or drop files anywhere on this page.");
  });
  it("animates in (closed first, then open) and stays mounted until the exit has finished", () => {
    vi.useFakeTimers();
    const { rerender } = render(ui({ phone: false, open: false }));
    expect(document.querySelector(".add-popover")).toBeNull();
    rerender(ui({ phone: false, open: true }));
    expect(document.querySelector(".add-popover")!.getAttribute("data-state")).toBe("closed");
    act(() => { vi.advanceTimersByTime(50); });
    expect(document.querySelector(".add-popover")!.getAttribute("data-state")).toBe("open");
    rerender(ui({ phone: false, open: false }));
    expect(document.querySelector(".add-popover")!.getAttribute("data-state")).toBe("closed"); // fading out, still there
    act(() => { vi.advanceTimersByTime(POPOVER_MS - 10); });
    expect(document.querySelector(".add-popover")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(20); });
    expect(document.querySelector(".add-popover")).toBeNull();
  });
  it("a second step makes it wider and has a back arrow; closing and reopening starts at the menu again", () => {
    vi.useFakeTimers();
    const { rerender } = render(ui({ phone: false, open: true }));
    const pop = () => document.querySelector(".add-popover")!;
    expect(pop().hasAttribute("data-wide")).toBe(false);
    fireEvent.click(screen.getByRole("menuitem", { name: "Paste a YouTube link" }));
    expect(pop().hasAttribute("data-wide")).toBe(true);
    expect(document.querySelector(".add-foot")).toBeNull();
    rerender(ui({ phone: false, open: false }));
    act(() => { vi.advanceTimersByTime(200); });
    rerender(ui({ phone: false, open: true }));
    expect(pop().hasAttribute("data-wide")).toBe(false);
  });
  it("closes on Esc and on a tap outside, but not on a tap inside", () => {
    const close = vi.fn();
    render(ui({ phone: false, open: true, onClose: close }));
    fireEvent.pointerDown(document.querySelector(".add-popover")!);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
