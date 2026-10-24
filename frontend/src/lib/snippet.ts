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

/**
 * The fades happen just outside the line, so none of its words is quieter: playing begins FADE_IN seconds before the line
 * and rises to full volume as it starts; after its end the sound goes on for FADE_OUT seconds while it falls to silence.
 */
export const FADE_IN = 0.12;
export const FADE_OUT = 0.3;

/** The volume (0..1) at `time` for a sentence from `start` to `end`: full inside the line, a linear ramp just before and after it. */
export function fadeGain(time: number, start: number, end: number): number {
  const up = (time - (start - FADE_IN)) / FADE_IN;
  const down = (end + FADE_OUT - time) / FADE_OUT;
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
    const from = Math.max(0, snippet.start - FADE_IN);
    this.audio.currentTime = from;
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
      if (t >= snippet.end + FADE_OUT) this.stop();
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
