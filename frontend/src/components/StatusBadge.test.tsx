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
  it("shows only the spinner on a phone while lyrics load, with the words on a PC", () => {
    const { container, rerender } = render(<StatusBadge status={status("pending")} phone onFix={() => undefined} />);
    expect(container.querySelector(".status-text")).toBeNull();
    expect(container.querySelector(".spin")).not.toBeNull();
    rerender(<StatusBadge status={status("pending")} phone={false} onFix={() => undefined} />);
    expect(container.querySelector(".status-text")?.textContent).toBe("Looking for lyrics");
  });
  it("on a PC the message sits beside the icon, the full text is in the tooltip and a click fixes", () => {
    const fix = vi.fn();
    const { container } = render(<StatusBadge status={status("not_found")} phone={false} onFix={fix} />);
    expect(container.querySelector(".status-text")?.textContent).toBe("No lyrics found");
    expect(container.querySelector(".status-tip")?.textContent).toContain("LRCLIB has no synchronized lyrics");
    fireEvent.click(screen.getByRole("button"));
    expect(fix).toHaveBeenCalledTimes(1);
  });
  it("on a phone a tap opens a bubble with a fix button; a tap outside closes it", () => {
    const fix = vi.fn();
    const { container } = render(<StatusBadge status={status("needs_choice")} phone onFix={fix} />);
    expect(container.querySelector(".status-text")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose the right lyrics/ }));
    expect(document.querySelector(".status-bubble")).not.toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body); // the click that ends the tap is swallowed
    expect(document.querySelector(".status-bubble")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose the right lyrics/ }));
    fireEvent.click(screen.getByRole("button", { name: "Choose lyrics" }));
    expect(fix).toHaveBeenCalledTimes(1);
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
