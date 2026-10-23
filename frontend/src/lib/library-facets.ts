import { inLanguage, languageCounts, type LanguageCount } from "./languages";

export type StatusFilter = "all" | "ready" | "missing" | "duplicates";

export interface FacetSong {
  id: number;
  language: string;
  lyrics_status: string;
  available: boolean;
}

export interface FacetOptions<S extends FacetSong> {
  status: StatusFilter;
  language: string;
  /** search text / regex already applied by the caller */
  matches: (s: S) => boolean;
  /** ids the Duplicates filter shows (the copies, never the originals) */
  duplicateIds: ReadonlySet<number>;
}

export const isReady = (s: FacetSong): boolean => s.lyrics_status === "found" && s.available;

const byStatus = (s: FacetSong, status: StatusFilter, dup: ReadonlySet<number>): boolean =>
  status === "all" ? true : status === "duplicates" ? dup.has(s.id) : (status === "ready") === isReady(s);

/**
 * Counters that agree with what is on screen: each filter's number counts the songs that the OTHER active filters
 * (search, language, status) leave, so choosing a language or typing a search updates the status chips, and choosing a
 * status updates the language chips.
 */
export function facetCounts<S extends FacetSong>(songs: readonly S[], o: FacetOptions<S>): { status: Record<StatusFilter, number>; languages: LanguageCount[] } {
  const inScope = songs.filter((s) => inLanguage(s, o.language) && o.matches(s));
  const status: Record<StatusFilter, number> = {
    all: inScope.length,
    ready: inScope.filter(isReady).length,
    missing: inScope.filter((s) => !isReady(s)).length,
    duplicates: inScope.filter((s) => o.duplicateIds.has(s.id)).length,
  };
  const languages = languageCounts(songs.filter((s) => byStatus(s, o.status, o.duplicateIds) && o.matches(s)));
  return { status, languages };
}

/** The songs the list shows. */
export function visibleSongs<S extends FacetSong>(songs: readonly S[], o: FacetOptions<S>): S[] {
  return songs.filter((s) => byStatus(s, o.status, o.duplicateIds) && inLanguage(s, o.language) && o.matches(s));
}
