import { describe, expect, it } from "vitest";
import { parseTrackList } from "./track-list";

describe("parseTrackList", () => {
  it("reads an Exportify CSV (quotes, several artists, milliseconds)", () => {
    const csv = '"Track URI","Track Name","Album Name","Artist Name(s)","Duration (ms)"\n"spotify:track:1","Du Hast, live","Sehnsucht","Rammstein;Someone","234000"\n"spotify:track:2","Sonne","Mutter","Rammstein","270123"\n';
    expect(parseTrackList(csv)).toEqual([{ title: "Du Hast, live", artist: "Rammstein", duration: 234 }, { title: "Sonne", artist: "Rammstein", duration: 270.123 }]);
  });
  it("reads a TSV with mm:ss lengths and a BOM", () => {
    expect(parseTrackList("﻿Title\tArtist\tLength\nNeon\tJohn Mayer\t4:03\n")).toEqual([{ title: "Neon", artist: "John Mayer", duration: 243 }]);
  });
  it("reads plain lines: Artist - Title, numbers and bullets ignored, lines it cannot use left out", () => {
    const text = "1. Nena - 99 Luftballons\n- Rammstein – Du hast\n\nJust a title\nA - \n";
    expect(parseTrackList(text)).toEqual([
      { title: "99 Luftballons", artist: "Nena", duration: 0 }, { title: "Du hast", artist: "Rammstein", duration: 0 }, { title: "Just a title", artist: "", duration: 0 },
    ]);
  });
  it("is empty for nothing and stops at the limit", () => {
    expect(parseTrackList("   \n")).toEqual([]);
    expect(parseTrackList(Array.from({ length: 5 }, (_, i) => `A - T${i}`).join("\n"), 3)).toHaveLength(3);
  });
});
