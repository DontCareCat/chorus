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

const TITLE_HEADER = /^(track name|track|title|name|song|song name)$/i;

/**
 * The tracks of a pasted list or a CSV/TSV file exported from a playlist (for example with Exportify: columns "Track Name", "Artist Name(s)",
 * "Duration (ms)"), or plain lines: "Artist - Title" (a leading number or bullet is ignored). Lines it cannot use are left out.
 */
export function parseTrackList(text: string, max = 2000): TrackRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const sep = [",", "\t", ";"].find((s) => cells(lines[0]!, s).length > 1 && cells(lines[0]!, s).some((c) => TITLE_HEADER.test(c)));
  if (sep) {
    const head = cells(lines[0]!, sep);
    const title = head.findIndex((c) => TITLE_HEADER.test(c));
    const artist = head.findIndex((c) => /artist/i.test(c));
    const duration = head.findIndex((c) => /duration|length/i.test(c));
    const inMs = duration >= 0 && /ms|milli/i.test(head[duration]!);
    return lines.slice(1).flatMap((line) => {
      const row = cells(line, sep);
      const t = row[title] ?? "";
      if (!t) return [];
      return [{ title: t, artist: (artist >= 0 ? row[artist] ?? "" : "").split(/;|\|/)[0]!.trim(), duration: duration >= 0 ? seconds(row[duration] ?? "", inMs) : 0 }];
    }).slice(0, max);
  }
  return lines.flatMap((raw) => {
    const line = raw.replace(/^(?:\d+[.)]\s+|[-*•]\s+)/, "");
    const cut = /\s[-–—](?:\s|$)/.exec(line);
    if (!cut) return line ? [{ title: line, artist: "", duration: 0 }] : [];
    const artist = line.slice(0, cut.index).trim();
    const title = line.slice(cut.index + cut[0].length).trim();
    return title ? [{ title, artist, duration: 0 }] : [];
  }).slice(0, max);
}
