import { describe, expect, it } from "vitest";
import type { SongDto } from "../services/api";
import { sortSongs } from "./library-sort";

const song = (id: number, title: string, over: Partial<SongDto> = {}): SongDto => ({
  id, title, artist: "A", album: null, duration: 100, language: "de", language_source: "default", lyrics_offset: 0, source: "upload", file_name: `${id}.wav`,
  available: true, has_cover: false, cover_source: null, lyrics_status: "found", created_at: `2026-01-0${id}T00:00:00Z`, best_score: null, plays: 0, last_played_at: null, ...over,
});
const ids = (l: SongDto[]) => l.map((s) => s.id);

describe("sortSongs", () => {
  const list = [
    song(1, "zebra", { best_score: 100, plays: 1, last_played_at: "2026-03-01T00:00:00Z" }),
    song(2, "Äpfel", { best_score: 300, plays: 5, last_played_at: "2026-02-01T00:00:00Z" }),
    song(3, "mond"),
    song(4, "Mond", { best_score: 200, plays: 2, last_played_at: "2026-04-01T00:00:00Z" }),
  ];
  it("names run A to Z ignoring case and accents, and reverse", () => {
    expect(ids(sortSongs(list, { key: "name", dir: "default" }))).toEqual([2, 3, 4, 1]);
    expect(ids(sortSongs(list, { key: "name", dir: "reverse" }))).toEqual([1, 3, 4, 2]);
  });
  it("score: best first, reverse worst first, never played always last", () => {
    expect(ids(sortSongs(list, { key: "score", dir: "default" }))).toEqual([2, 4, 1, 3]);
    expect(ids(sortSongs(list, { key: "score", dir: "reverse" }))).toEqual([1, 4, 2, 3]);
  });
  it("plays: most first; unplayed last either way", () => {
    expect(ids(sortSongs(list, { key: "plays", dir: "default" }))).toEqual([2, 4, 1, 3]);
    expect(ids(sortSongs(list, { key: "plays", dir: "reverse" }))).toEqual([1, 4, 2, 3]);
  });
  it("added: newest first", () => {
    expect(ids(sortSongs(list, { key: "added", dir: "default" }))).toEqual([4, 3, 2, 1]);
    expect(ids(sortSongs(list, { key: "added", dir: "reverse" }))).toEqual([1, 2, 3, 4]);
  });
  it("recently played: latest first; unplayed last", () => {
    expect(ids(sortSongs(list, { key: "played", dir: "default" }))).toEqual([4, 1, 2, 3]);
  });
  it("ties break on the title, then the id, and the input is not changed", () => {
    const same = [song(2, "b", { plays: 1 }), song(1, "a", { plays: 1 })];
    expect(ids(sortSongs(same, { key: "plays", dir: "default" }))).toEqual([1, 2]);
    expect(ids(same)).toEqual([2, 1]);
  });
});
