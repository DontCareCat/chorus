import type { SongDto } from "../services/api";

export type SortKey = "name" | "score" | "plays" | "added" | "played";
export type SortDir = "default" | "reverse";
export interface SortChoice { key: SortKey; dir: SortDir }

export const SORT_KEYS: readonly SortKey[] = ["name", "score", "plays", "added", "played"];
export const DEFAULT_SORT: SortChoice = { key: "name", dir: "default" };

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The "forward" order of each key: A to Z, best first, most first, newest first, most recent first. */
function compare(key: SortKey, a: SongDto, b: SongDto): number {
  switch (key) {
    case "name": return collator.compare(a.title, b.title) || collator.compare(a.artist, b.artist);
    case "score": return (b.best_score ?? -1) - (a.best_score ?? -1);
    case "plays": return b.plays - a.plays;
    case "added": return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    case "played": return (b.last_played_at ?? "").localeCompare(a.last_played_at ?? "");
  }
}

/** Songs the user never played (no score / plays / last played) always go last, whichever way the list runs; ties fall back to the title. */
function unplayed(key: SortKey, s: SongDto): boolean {
  return (key === "score" && s.best_score === null) || (key === "plays" && s.plays === 0) || (key === "played" && !s.last_played_at);
}

export function sortSongs(songs: readonly SongDto[], { key, dir }: SortChoice): SongDto[] {
  const sign = dir === "reverse" ? -1 : 1;
  return [...songs].sort((a, b) => {
    const ua = unplayed(key, a), ub = unplayed(key, b);
    if (ua !== ub) return ua ? 1 : -1;
    if (ua && ub) return collator.compare(a.title, b.title) || a.id - b.id;
    return sign * compare(key, a, b) || collator.compare(a.title, b.title) || a.id - b.id;
  });
}

/** What the right-hand value of a row says for this key (the list is sorted by it). */
export function sortValue(key: SortKey, s: SongDto): { kind: "score" | "plays" | "added" | "played"; value: number | string } | null {
  switch (key) {
    case "score": return s.best_score === null ? null : { kind: "score", value: s.best_score };
    case "plays": return s.plays ? { kind: "plays", value: s.plays } : null;
    case "added": return s.created_at ? { kind: "added", value: s.created_at } : null;
    case "played": return s.last_played_at ? { kind: "played", value: s.last_played_at } : null;
    default: return null;
  }
}
