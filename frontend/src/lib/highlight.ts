export interface Piece {
  text: string;
  hit: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A sentence cut into pieces so the word that was asked (any case, whole word) can be marked. */
export function highlight(sentence: string, word: string): Piece[] {
  const w = word.trim();
  if (!w) return [{ text: sentence, hit: false }];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${escape(w)})(?![\\p{L}\\p{N}])`, "giu");
  const out: Piece[] = [];
  let last = 0;
  for (const m of sentence.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: sentence.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last), hit: false });
  return out.length ? out : [{ text: sentence, hit: false }];
}
