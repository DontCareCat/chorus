import { describe, expect, it } from "vitest";
import { resultText } from "./LookupBar";
import type { SongDto } from "../services/api";

const song = (id: number, lyrics_status: SongDto["lyrics_status"]) => ({ id, lyrics_status }) as SongDto;

describe("resultText", () => {
  it("says what happened to the songs of the run, and leaves out what did not happen", () => {
    const songs = [song(1, "found"), song(2, "found"), song(3, "needs_choice"), song(4, "not_found"), song(5, "found"), song(6, "pending")];
    expect(resultText(songs, new Set([1, 2, 3, 4]))).toBe("Done: 2 found, 1 needs a choice, 1 not found");
    expect(resultText(songs, new Set([1, 2]))).toBe("Done: 2 found");
    expect(resultText(songs, new Set([]))).toBe("Done");
  });
});
