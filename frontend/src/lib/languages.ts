export interface WithLanguage {
  language: string;
}

export interface LanguageCount {
  code: string;
  count: number;
}

/** The languages that occur in the library with how many songs each has, most songs first (ties by code). */
export function languageCounts(songs: readonly WithLanguage[]): LanguageCount[] {
  const counts = new Map<string, number>();
  for (const s of songs) counts.set(s.language, (counts.get(s.language) ?? 0) + 1);
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** "all" shows everything; otherwise only songs in that language. */
export const inLanguage = (song: WithLanguage, selected: string): boolean => selected === "all" || song.language === selected;
