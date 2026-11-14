// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { songStatus } from "../lib/lyrics-status";
import type { SongDto } from "../services/api";
import { SongMenu } from "./SongMenu";

afterEach(cleanup);
const song = { id: 4, title: "Du hast", artist: "Rammstein", lyrics_status: "not_found", available: true } as SongDto;

describe("SongMenu", () => {
  it("lists the song tools and marks Find lyrics with a warning when lyrics are missing", () => {
    render(<SongMenu song={song} status={songStatus(song)} phone={false} anchor={null} onPick={() => undefined} onClose={() => undefined} />);
    const items = screen.getAllByRole("menuitem").map((e) => e.textContent);
    expect(items[0]).toMatch(/^Find lyrics/);
    expect(items.slice(1)).toEqual(["Change cover", "Change language", "Edit title, artist, album", "Edit lyrics timingNo lyrics yet", "Export .lrc fileNo lyrics yet", "Remove from library"]);
    expect(screen.getByRole("menuitem", { name: /Edit lyrics timing/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Export .lrc file/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("menuitem", { name: /Find lyrics/ }).querySelector(".mi-warn")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Change cover" }).querySelector(".mi-warn")).toBeNull();
  });
  it("shows no warning when the lyrics are fine, and reports the picked tool", () => {
    const ok = { ...song, lyrics_status: "found" } as SongDto;
    const pick = vi.fn();
    render(<SongMenu song={ok} status={songStatus(ok)} phone={false} anchor={null} onPick={pick} onClose={() => undefined} />);
    expect(document.querySelector(".mi-warn")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Change language" }));
    expect(pick).toHaveBeenCalledWith("language");
    // with lyrics the timing editor opens from the menu and the .lrc export is a menu action
    const timing = screen.getByRole("menuitem", { name: /Edit lyrics timing/ });
    expect(timing.getAttribute("href")).toBe("#/songs/4/timing");
    fireEvent.click(screen.getByRole("menuitem", { name: "Export .lrc file" }));
    expect(pick).toHaveBeenCalledWith("export");
  });
  it("shows the NEW badge on the timing editor for the first three menu openings only", () => {
    localStorage.removeItem("timing_new_seen");
    const ok = { ...song, lyrics_status: "found" } as SongDto;
    const open = () => { const { unmount } = render(<SongMenu song={ok} status={songStatus(ok)} phone={false} anchor={null} onPick={() => undefined} onClose={() => undefined} />); const has = !!document.querySelector(".badge-new"); unmount(); return has; };
    expect([open(), open(), open(), open()]).toEqual([true, true, true, false]);
  });
  it("is a bottom sheet with the song's name on a phone and closes on Esc", () => {
    const close = vi.fn();
    render(<SongMenu song={song} status={songStatus(song)} phone anchor={null} onPick={() => undefined} onClose={close} />);
    expect(document.querySelector(".sheet-scrim .sheet-head")?.textContent).toContain("Du hast");
    vi.useFakeTimers();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".sheet")?.getAttribute("data-state")).toBe("closing"); // it rolls away first
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    expect(close).toHaveBeenCalled();
  });
});
