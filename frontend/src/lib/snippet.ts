/** The part of an <audio> element the snippet player uses (so tests can pass a fake). */
export interface AudioLike {
  src: string;
  currentTime: number;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error" | "pause", fn: () => void): void;
}

export interface Snippet {
  songId: number;
  start: number;
  end: number;
}

/** Seconds a sentence takes to fade in and out (never more than 40 % of its length each, so short lines still fade). */
export const FADE_IN = 0.15;
export const FADE_OUT = 0.3;

/** The volume (0..1) at `time` for a sentence from `start` to `end`: a linear fade in at its start and out at its end. */
export function fadeGain(time: number, start: number, end: number): number {
  const len = Math.max(0.001, end - start);
  const fin = Math.min(FADE_IN, len * 0.4), fout = Math.min(FADE_OUT, len * 0.4);
  const up = fin > 0 ? (time - start) / fin : 1;
  const down = fout > 0 ? (end - time) / fout : 1;
  return Math.min(1, Math.max(0, Math.min(up, down)));
}

type Timer = ReturnType<typeof setInterval>;

/**
 * Plays one sentence of a song: from its start to its end, then stops. One snippet at a time; starting another stops the
 * first, and asking for the one that is playing stops it. `onChange` reports which key is playing (null = none).
 */
export class SnippetPlayer {
  private key: string | null = null;
  private loaded: number | null = null;
  private timer: Timer | null = null;
  private listeners = new Set<(key: string | null) => void>();

  constructor(
    private readonly audio: AudioLike,
    private readonly urlFor: (songId: number) => string,
    private readonly pollMs = 20,
    private readonly setTimer: (fn: () => void, ms: number) => Timer = (fn, ms) => setInterval(fn, ms), // (not the bare global: it must not be called as a method)
    private readonly clearTimer: (t: Timer) => void = (t) => clearInterval(t),
  ) {
    audio.addEventListener("ended", () => this.stop());
    audio.addEventListener("error", () => this.stop());
  }

  get playing(): string | null {
    return this.key;
  }

  onChange(fn: (key: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(key: string | null) {
    this.key = key;
    this.listeners.forEach((fn) => fn(key));
  }

  /** Starts the snippet, or stops it when it is the one playing. Resolves false when the browser refused to play. */
  async toggle(key: string, snippet: Snippet): Promise<boolean> {
    if (this.key === key) {
      this.stop();
      return true;
    }
    this.stop();
    if (this.loaded !== snippet.songId) {
      this.audio.src = this.urlFor(snippet.songId);
      this.loaded = snippet.songId;
    }
    this.audio.volume = 0; // fades in from silence: a line cut out of a song must not start with a click
    this.audio.currentTime = Math.max(0, snippet.start);
    this.set(key);
    try {
      await this.audio.play();
    } catch {
      if (this.key === key) this.stop();
      return false;
    }
    if (this.key !== key) return true; // stopped or replaced while the browser was starting
    const tick = () => {
      const t = this.audio.currentTime;
      if (t >= snippet.end) this.stop();
      else this.audio.volume = fadeGain(t, snippet.start, snippet.end);
    };
    tick();
    this.timer = this.setTimer(tick, this.pollMs);
    return true;
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.key !== null) {
      this.audio.pause();
      this.audio.volume = 1;
      this.set(null);
    }
  }
}
