import { describe, expect, it } from "vitest";
import { songStatus } from "./lyrics-status";

describe("songStatus", () => {
  it("shows nothing for a ready song", () => {
    expect(songStatus({ lyrics_status: "found", available: true })).toMatchObject({ kind: "ready", short: "", fix: null });
  });
  it("animates while the search runs", () => {
    expect(songStatus({ lyrics_status: "pending", available: true })).toMatchObject({ kind: "pending", fix: null });
  });
  it("warns (yellow) when the user must choose", () => {
    expect(songStatus({ lyrics_status: "needs_choice", available: true })).toMatchObject({ kind: "warn", fix: "lyrics" });
  });
  it("is an error (red) when there are no lyrics or no file", () => {
    expect(songStatus({ lyrics_status: "not_found", available: true })).toMatchObject({ kind: "error", fix: "lyrics" });
    expect(songStatus({ lyrics_status: "found", available: false })).toMatchObject({ kind: "error", fix: "file" });
  });
  it("has a short and a full message for every problem", () => {
    for (const st of ["pending", "needs_choice", "not_found"]) {
      const r = songStatus({ lyrics_status: st, available: true });
      expect(r.short.length).toBeGreaterThan(0);
      expect(r.full.length).toBeGreaterThan(r.short.length);
    }
  });
});

describe("stalled lookups", () => {
  it("warn with the Find lyrics fix instead of spinning forever", () => {
    const st = songStatus({ lyrics_status: "pending", lyrics_stalled: true, available: true });
    expect([st.kind, st.fix]).toEqual(["warn", "lyrics"]);
  });
  it("keep spinning while inside the timeout", () => {
    expect(songStatus({ lyrics_status: "pending", lyrics_stalled: false, available: true }).kind).toBe("pending");
  });
});
