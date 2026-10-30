export interface TrackRow { title: string; artist: string; duration: number }

/** Splits one CSV / TSV line (quotes may hold the separator). */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** "3:54" or "234" or "234000" (milliseconds when the header says so or the number is large) → seconds; 0 when unknown. */
function seconds(raw: string, inMs: boolean): number {
  const t = raw.trim();
  const clock = /^(\d+):(\d{1,2})$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return inMs || n > 20_000 ? n / 1000 : n;
}

/** The server takes at most this many characters of a title or an artist. */
const CELL_MAX = 300;
export const TRACK_LIST_MAX = 2000;

const TITLE_HEADER = /^(track name|track|title|name|song|song name)$/i;

/**
 * The tracks of a pasted list or a CSV/TSV file exported from a playlist (for example with Exportify: columns "Track Name", "Artist Name(s)",
 * "Duration (ms)"), or plain lines: "Artist - Title" (a leading number or bullet is ignored). Lines it cannot use are left out.
 */
export function parseTrackList(text: string, max = TRACK_LIST_MAX): TrackRow[] {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines: string[] = [];
  let open = "";
  for (const l of raw) { // a quoted cell may hold a line break: the record goes on until its quotes are closed
    const joined = open ? `${open}\n${l}` : l;
    if ((joined.match(/"/g) ?? []).length % 2 === 1) { open = joined; continue; }
    open = "";
    if (joined.trim()) lines.push(joined.trim());
  }
  if (open.trim()) lines.push(open.trim());
  if (lines.length === 0) return [];
  const sep = [",", "\t", ";"].find((s) => { const h = cells(lines[0]!, s); return h.length > 1 && h.some((c) => TITLE_HEADER.test(c)) && h.some((c) => /artist/i.test(c)); });
  if (sep) {
    const head = cells(lines[0]!, sep);
    const title = head.findIndex((c) => TITLE_HEADER.test(c));
    const named = head.findIndex((c) => /artist.*name|^artists?$/i.test(c)); // not "Artist URI(s)", which can come first
    const artist = named >= 0 ? named : head.findIndex((c) => /artist/i.test(c) && !/uri|id\b/i.test(c));
    const duration = head.findIndex((c) => /duration|length/i.test(c));
    const inMs = duration >= 0 && /ms|milli/i.test(head[duration]!);
    return lines.slice(1).flatMap((line) => {
      const row = cells(line, sep);
      const t = row[title] ?? "";
      if (!t) return [];
      return [{ title: t.slice(0, CELL_MAX), artist: (artist >= 0 ? row[artist] ?? "" : "").split(/;|\|/)[0]!.trim().slice(0, CELL_MAX), duration: duration >= 0 ? seconds(row[duration] ?? "", inMs) : 0 }];
    }).slice(0, max);
  }
  return lines.flatMap((raw) => {
    const line = raw.replace(/^(?:\d+[.)]\s+|[-*•]\s+)/, "");
    const cut = /\s[-–—](?:\s|$)/.exec(line);
    if (!cut) return line ? [{ title: line.slice(0, CELL_MAX), artist: "", duration: 0 }] : [];
    const artist = line.slice(0, cut.index).trim();
    const title = line.slice(cut.index + cut[0].length).trim();
    return title ? [{ title: title.slice(0, CELL_MAX), artist: artist.slice(0, CELL_MAX), duration: 0 }] : [];
  }).slice(0, max);
}
