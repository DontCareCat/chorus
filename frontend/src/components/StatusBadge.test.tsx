// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { songStatus } from "../lib/lyrics-status";
import { StatusBadge } from "./StatusBadge";

afterEach(cleanup);
const status = (lyrics_status: string, available = true) => songStatus({ lyrics_status, available });

describe("StatusBadge", () => {
  it("renders nothing for a ready song", () => {
    const { container } = render(<StatusBadge status={status("found")} phone={false} onFix={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });
  it("is a tag with a still clock while lyrics load (no spinner near the songs), also on a phone", () => {
    const { container } = render(<StatusBadge status={status("pending")} phone onFix={() => undefined} />);
    const tag = screen.getByRole("button");
    expect(tag.className).toBe("tag status-tag");
    expect(tag.textContent).toBe("Looking up");
    expect(container.querySelector(".wait")).not.toBeNull();
    expect(container.querySelector(".spin")).toBeNull();
  });
  it("shows the problem as a short tag; a click opens the bubble under it on a PC, with the fix button", () => {
    const fix = vi.fn();
    render(<StatusBadge status={status("not_found")} phone={false} onFix={fix} />);
    expect(screen.getByRole("button").textContent).toBe("No lyrics");
    fireEvent.click(screen.getByRole("button"));
    expect(document.querySelector(".status-tag")!.getAttribute("data-open")).toBe("true");
    const bubble = document.querySelector<HTMLElement>(".status-bubble")!;
    expect(bubble.getAttribute("data-below")).toBe("true");
    expect(bubble.textContent).toContain("LRCLIB has no synchronized lyrics");
    expect(fix).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Find lyrics" }));
    expect(fix).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".status-bubble")).toBeNull();
  });
  it("a YouTube song that cannot be played says so, and the bubble's action plays the next song", () => {
    const st = songStatus({ lyrics_status: "found", available: false, source: "youtube" });
    expect([st.tag, st.fix, st.fixLabel]).toEqual(["Can't play", "next", "Play the next song"]);
  });
  it("on a phone a tap opens a bubble above the tag with a fix button; a tap outside closes it", () => {
    const fix = vi.fn();
    render(<StatusBadge status={status("needs_choice")} phone onFix={fix} />);
    fireEvent.click(screen.getByRole("button", { name: /Choose the right lyrics/ }));
    expect(document.querySelector(".status-bubble")).not.toBeNull();
    expect(document.querySelector(".status-bubble")?.hasAttribute("data-below")).toBe(false);
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body); // the click that ends the tap is swallowed
    expect(document.querySelector(".status-bubble")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose the right lyrics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Choose lyrics" }));
    expect(fix).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".status-bubble")).toBeNull();
  });
  it("Esc closes the bubble", () => {
    render(<StatusBadge status={status("not_found")} phone={false} onFix={() => undefined} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".status-bubble")).toBeNull();
  });
  it("a scroll closes the bubble", () => {
    render(<StatusBadge status={status("not_found")} phone onFix={() => undefined} />);
    fireEvent.click(screen.getByRole("button"));
    expect(document.querySelector(".status-bubble")).not.toBeNull();
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(document.querySelector(".status-bubble")).toBeNull();
  });
});
