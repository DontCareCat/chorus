export interface Searchable {
  title: string;
  artist: string;
  album: string | null;
  file_name: string;
}

export interface Matcher {
  test: (song: Searchable) => boolean;
  /** Set when regex mode is on and the pattern is not a valid regular expression (the list is then left as it is). */
  error: string | null;
}

const MAX_PATTERN = 200;

/**
 * The library search. Plain text: every word must appear in the title, artist, album or file name (any order, any case).
 * Regex mode: a case-insensitive regular expression tested against each of those fields; an invalid pattern shows
 * everything and says why instead of an empty list.
 */
export function buildMatcher(query: string, regex: boolean): Matcher {
  const q = query.trim();
  if (!q) return { test: () => true, error: null };
  const fields = (s: Searchable) => [s.title, s.artist, s.album ?? "", s.file_name];
  if (!regex) {
    const words = q.toLowerCase().split(/\s+/);
    return { test: (s) => { const hay = fields(s).join(" \n ").toLowerCase(); return words.every((w) => hay.includes(w)); }, error: null };
  }
  if (q.length > MAX_PATTERN) return { test: () => true, error: `The pattern is too long (at most ${MAX_PATTERN} characters).` };
  try {
    const re = new RegExp(q, "i");
    return { test: (s) => fields(s).some((f) => re.test(f)), error: null };
  } catch (e) {
    return { test: () => true, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Not a valid regular expression." };
  }
}
