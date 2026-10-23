import { en } from "../i18n/en";

export type StatusKind = "ready" | "pending" | "warn" | "error";
/** Which dialog fixes the problem. */
export type StatusFix = "lyrics" | "file" | null;

export interface SongStatus {
  kind: StatusKind;
  short: string;
  full: string;
  fix: StatusFix;
  fixLabel: string;
}

export interface StatusSong {
  lyrics_status: string;
  available: boolean;
}

/** What the list says about a song's lyrics: nothing when it is ready, a spinner while the search runs, a warning when you can fix it, an error when it cannot be played. */
export function songStatus(s: StatusSong): SongStatus {
  const t = en.songStatus;
  if (!s.available) return { kind: "error", short: t.fileMissing.short, full: t.fileMissing.full, fix: "file", fixLabel: t.fileMissing.fix };
  switch (s.lyrics_status) {
    case "found": return { kind: "ready", short: "", full: "", fix: null, fixLabel: "" };
    case "pending": return { kind: "pending", short: t.pending.short, full: t.pending.full, fix: null, fixLabel: "" };
    case "needs_choice": return { kind: "warn", short: t.needsChoice.short, full: t.needsChoice.full, fix: "lyrics", fixLabel: t.needsChoice.fix };
    default: return { kind: "error", short: t.notFound.short, full: t.notFound.full, fix: "lyrics", fixLabel: t.notFound.fix };
  }
}
