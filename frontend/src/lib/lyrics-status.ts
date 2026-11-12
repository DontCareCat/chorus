import { en } from "../i18n/en";

export type StatusKind = "ready" | "pending" | "warn" | "error";
/** Which dialog fixes the problem. */
export type StatusFix = "lyrics" | "file" | "youtube" | null;

export interface SongStatus {
  kind: StatusKind;
  short: string;
  /** the words on the tag in the song row */
  tag: string;
  full: string;
  fix: StatusFix;
  fixLabel: string;
}

export interface StatusSong {
  lyrics_status: string;
  lyrics_stalled?: boolean;
  available: boolean;
  source?: string;
}

/** What the list says about a song's lyrics: nothing when it is ready, a spinner while the search runs, a warning when you can fix it, an error when it cannot be played. */
export function songStatus(s: StatusSong): SongStatus {
  const t = en.songStatus;
  if (!s.available && s.source === "youtube") return { kind: "error", short: t.cantPlay.short, tag: t.cantPlay.tag, full: t.cantPlay.full, fix: "youtube", fixLabel: t.cantPlay.fix };
  if (!s.available) return { kind: "error", short: t.fileMissing.short, tag: t.fileMissing.tag, full: t.fileMissing.full, fix: "file", fixLabel: t.fileMissing.fix };
  switch (s.lyrics_status) {
    case "found": return { kind: "ready", short: "", tag: "", full: "", fix: null, fixLabel: "" };
    case "pending":
      if (s.lyrics_stalled) return { kind: "warn", short: t.stalled.short, tag: t.stalled.tag, full: t.stalled.full, fix: "lyrics", fixLabel: t.stalled.fix };
      return { kind: "pending", short: t.pending.short, tag: t.pending.tag, full: t.pending.full, fix: null, fixLabel: "" };
    case "needs_choice": return { kind: "warn", short: t.needsChoice.short, tag: t.needsChoice.tag, full: t.needsChoice.full, fix: "lyrics", fixLabel: t.needsChoice.fix };
    default: return { kind: "error", short: t.notFound.short, tag: t.notFound.tag, full: t.notFound.full, fix: "lyrics", fixLabel: t.notFound.fix };
  }
}
