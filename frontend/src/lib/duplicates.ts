export interface DuplicateCandidate {
  id: number;
  title: string;
  artist: string;
  duration: number;
  file_name: string;
}

export type DuplicateReason = "file_name" | "metadata";

export interface DuplicateGroup {
  ids: number[];
  reasons: DuplicateReason[];
}

/** Two songs with the same title and artist count as the same recording when their lengths differ by less than this. */
export const DURATION_TOLERANCE = 3;

const fold = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** File name without its extension and without the marks a copy gets: "(1)", "- copy", "copy of". */
export function nameKey(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, "");
  return fold(stem.replace(/\s*\(\d+\)\s*$/, "").replace(/\s*[-_ ]\s*copy(\s*\d+)?\s*$/i, "").replace(/^copy of\s+/i, ""));
}

/** Title with a trailing "(feat. …)", "(remastered)" or "[live]" style remark dropped, so the same song under two spellings still meets. */
export function titleKey(title: string): string {
  return fold(title.replace(/[([][^)\]]*[)\]]\s*$/, ""));
}

/**
 * Songs that are probably the same recording. Byte-identical files never get here (the library keeps one song per file
 * content), so this finds the other kind: the same file name in two folders or formats, and the same title and artist
 * with nearly the same length. Groups are connected components: if A matches B by name and B matches C by tags, all three
 * form one group.
 */
export function findDuplicates(songs: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const parent = new Map<number, number>(songs.map((s) => [s.id, s.id]));
  const find = (x: number): number => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const reasons = new Map<number, Set<DuplicateReason>>();
  const link = (a: number, b: number, why: DuplicateReason) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
    for (const id of [a, b]) { const r = find(id); reasons.set(r, new Set([...(reasons.get(r) ?? []), ...(reasons.get(ra) ?? []), ...(reasons.get(rb) ?? []), why])); }
  };

  const byName = new Map<string, DuplicateCandidate[]>();
  const byTags = new Map<string, DuplicateCandidate[]>();
  for (const s of songs) {
    const n = nameKey(s.file_name);
    if (n) byName.set(n, [...(byName.get(n) ?? []), s]);
    const t = titleKey(s.title);
    if (t) byTags.set(`${t}|${fold(s.artist)}`, [...(byTags.get(`${t}|${fold(s.artist)}`) ?? []), s]);
  }
  for (const list of byName.values()) for (const other of list.slice(1)) link(list[0]!.id, other.id, "file_name");
  for (const list of byTags.values()) {
    list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
      if (Math.abs(a.duration - b.duration) < DURATION_TOLERANCE) link(a.id, b.id, "metadata");
    }));
  }

  const groups = new Map<number, number[]>();
  for (const s of songs) groups.set(find(s.id), [...(groups.get(find(s.id)) ?? []), s.id]);
  return [...groups]
    .filter(([, ids]) => ids.length > 1)
    .map(([root, ids]) => ({ ids, reasons: (["file_name", "metadata"] as const).filter((r) => reasons.get(find(root))?.has(r)) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.ids[0]! - b.ids[0]!);
}

export interface CopyInfo {
  /** Songs shown by the Duplicates filter: every member of a group except the one kept. */
  extras: Set<number>;
  /** extra song id -> the id of the song it is a copy of (the one kept) */
  keeper: Map<number, number>;
  /** extra song id -> why it matched (file name, title + artist) */
  reasons: Map<number, DuplicateReason[]>;
}

/**
 * The copies, not the originals: in every group the oldest song (the lowest id: it was added first) is kept out of the
 * list, so "select all" + "remove" deletes only the extra entries and the original stays.
 */
export function extraCopies(groups: readonly DuplicateGroup[]): CopyInfo {
  const info: CopyInfo = { extras: new Set(), keeper: new Map(), reasons: new Map() };
  for (const g of groups) {
    const keep = Math.min(...g.ids);
    for (const id of g.ids) {
      if (id === keep) continue;
      info.extras.add(id);
      info.keeper.set(id, keep);
      info.reasons.set(id, g.reasons);
    }
  }
  return info;
}
