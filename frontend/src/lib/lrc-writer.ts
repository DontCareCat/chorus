/** The .lrc file of a song's lyrics (the export of the timing editor). Mirrors backend services/lyrics/lrc_writer.py and the app's packages/core; the preview shows what the download will hold. */
export function stamp(seconds: number): string {
  const hundredths = Math.round(Math.max(0, seconds) * 100 + 1e-9);
  const m = Math.floor(hundredths / 6000), rest = hundredths % 6000;
  return `[${String(m).padStart(2, "0")}:${String(Math.floor(rest / 100)).padStart(2, "0")}.${String(rest % 100).padStart(2, "0")}]`;
}

export const lengthTag = (duration: number): string => {
  const total = Math.round(duration);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** `Artist - Title.lrc`; characters a file name cannot hold become `_`. */
export function lrcFileName(artist: string, title: string): string {
  const base = (artist.trim() ? `${artist.trim()} - ${title.trim()}` : title.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^[ .]+|[ .]+$/g, "") || "lyrics";
  return `${base}.lrc`;
}

export interface LrcSong { title: string; artist: string; album: string | null; duration: number }

/** UTF-8 text, `\n` line ends, no BOM. Lines without a time are left out; an empty line keeps its time. */
export function buildLrc(song: LrcSong, lines: readonly { time: number | null; text: string }[]): string {
  const out = [`[ti:${song.title}]`];
  if (song.artist) out.push(`[ar:${song.artist}]`);
  if (song.album) out.push(`[al:${song.album}]`);
  if (song.duration > 0) out.push(`[length:${lengthTag(song.duration)}]`);
  out.push("[re:Chorus]");
  for (const l of lines) if (l.time != null) out.push(`${stamp(l.time)}${l.text}`);
  return `${out.join("\n")}\n`;
}
