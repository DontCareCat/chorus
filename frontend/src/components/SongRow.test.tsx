// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SongDto } from "../services/api";
import { SongRow } from "./SongList";

afterEach(cleanup);
const handlers = { queue: vi.fn(), pick: vi.fn(), longPress: vi.fn(), toggle: vi.fn(), menu: vi.fn(), fix: vi.fn() };
const song = (p: Partial<SongDto> = {}) => ({
  id: 1, title: "Du hast", artist: "Rammstein", album: null, duration: 214, language: "de", language_source: "default", lyrics_offset: 0,
  source: "library", file_name: "a.mp3", available: true, has_cover: false, cover_source: null, lyrics_status: "found", created_at: "", best_score: null,
  plays: 0, last_played_at: null, ...p,
}) as SongDto;
const row = (s: SongDto, o: { phone?: boolean; duplicate?: boolean; gone?: boolean; sortKey?: "plays" | null } = {}) =>
  render(<ul><SongRow
    song={s} sortKey={o.sortKey ?? null} handlers={handlers} selectable={false} orderable={false} reorderRow={false} gone={o.gone ?? false} phone={o.phone ?? false}
    selectionActive={false} picked={false} duplicate={o.duplicate ? ["same_file" as never] : undefined} open={false} games={[]} menuOpen={false}
  /></ul>);
const tags = () => [...document.querySelectorAll(".tag-row > *")];

describe("SongRow", () => {
  it("has the title, the artist line and the tag row in the text column, and the length in its own column", () => {
    row(song());
    const text = document.querySelector(".song-text")!;
    expect([...text.children].map((c) => c.className)).toEqual(["song-title", "song-meta", "tag-row"]);
    expect(document.querySelector(".song-meta")!.textContent).toBe("Rammstein");
    expect(document.querySelector(".song-length")!.textContent).toBe("3:34");
    expect(document.querySelector(".song-main > .song-length")).not.toBeNull();
    expect(document.querySelector(".status-cell, .status-slot")).toBeNull();
  });
  it("uses one tag class for the language, YouTube, album timing, copy hint and removed tags", () => {
    row(song({ source: "youtube", youtube_id: "abc", youtube_channel: "Artist - Topic" }), { duplicate: true, gone: true });
    expect(tags().length).toBeGreaterThanOrEqual(5);
    for (const t of tags()) expect(t.className).toBe("tag");
    expect(document.querySelector(".yt-tag, .dup-tag, .lang")).toBeNull();
  });
  it("keeps the sorted-by value as plain text after the artist", () => {
    row(song({ plays: 3 }), { sortKey: "plays" });
    const spans = [...document.querySelectorAll(".song-meta > span")];
    expect(spans[0]!.textContent).toBe("Rammstein");
    expect(spans[1]!.className).toBe("sorted-by");
  });
  it("shows no status tag for a ready song, and a status tag (inside the tag row) otherwise", () => {
    row(song());
    expect(document.querySelector(".status-tag")).toBeNull();
    cleanup();
    row(song({ lyrics_status: "needs_choice" }), { phone: true });
    const tag = document.querySelector(".tag-row .status-tag")!;
    expect(tag.className).toBe("tag status-tag");
    fireEvent.click(tag);
    expect(document.querySelector(".status-bubble")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose lyrics" }));
    expect(handlers.fix).toHaveBeenCalledTimes(1);
  });
  it("shows the length of a YouTube song when it is known, and keeps the column empty otherwise", () => {
    row(song({ source: "youtube", duration: 125 }));
    expect(document.querySelector(".song-length")!.textContent).toBe("2:05");
    cleanup();
    row(song({ source: "youtube", duration: 0 }));
    expect(document.querySelector(".song-length")!.textContent).toBe("");
  });
  it("has no second line for a YouTube song that cannot be played: the status tag says Can't play", () => {
    row(song({ source: "youtube", youtube_id: "abc", available: false }));
    expect(document.querySelector(".yt-unplayable")).toBeNull();
    expect(document.querySelector(".status-tag")!.textContent).toBe("Can't play");
  });
});
