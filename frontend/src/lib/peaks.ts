import { packPeaks, peaksFromSamples, unpackPeaks } from "../game/strip";
import type { Peaks } from "../game/strip";

const KEY = (songId: number) => `chorus-peaks-${songId}`;
const memory = new Map<number, Peaks>();
const pending = new Map<number, Promise<Peaks | null>>();

/** Decode at a low rate: loudness needs no more, and a long song then costs a few MB instead of hundreds. */
const DECODE_RATE = 8000;

function stored(songId: number, duration: number): Peaks | null {
  try {
    const raw = localStorage.getItem(KEY(songId));
    if (!raw) return null;
    const [len, data] = raw.split(":");
    const p = unpackPeaks(data ?? "");
    // a song that was replaced under the same id has another length
    if (!p || Math.abs(p.values.length / p.perSecond - Number(len)) > 2 || (duration > 0 && Math.abs(Number(len) - duration) > 3)) return null;
    return p;
  } catch { return null; }
}

function keep(songId: number, p: Peaks) {
  memory.set(songId, p);
  try { localStorage.setItem(KEY(songId), `${Math.round(p.values.length / p.perSecond)}:${packPeaks(p)}`); } catch { /* storage full or blocked: only the memory copy */ }
}

/** The loudness of a song, 10 values a second, decoded once and kept (memory, then this browser's storage). Null when it cannot be decoded. */
export function loadPeaks(songId: number, url: string, duration: number): Promise<Peaks | null> {
  const known = memory.get(songId) ?? stored(songId, duration);
  if (known) { memory.set(songId, known); return Promise.resolve(known); }
  const running = pending.get(songId);
  if (running) return running;
  const job = (async () => {
    try {
      const Ctx = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
        ?? (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
      if (!Ctx) return null;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) return null;
      const buf = await new Ctx(1, DECODE_RATE, DECODE_RATE).decodeAudioData(await res.arrayBuffer());
      const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      const p = peaksFromSamples(channels, buf.sampleRate, 10);
      if (p.values.length === 0) return null;
      keep(songId, p);
      return p;
    } catch { return null; } finally { pending.delete(songId); }
  })();
  pending.set(songId, job);
  return job;
}
