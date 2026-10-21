/** The part of an <audio> element the snippet player uses (so tests can pass a fake). */
export interface AudioLike {
  src: string;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error" | "pause", fn: () => void): void;
}

export interface Snippet {
  songId: number;
  start: number;
  end: number;
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
    private readonly pollMs = 30,
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
    this.audio.currentTime = Math.max(0, snippet.start);
    this.set(key);
    try {
      await this.audio.play();
    } catch {
      if (this.key === key) this.stop();
      return false;
    }
    if (this.key !== key) return true; // stopped or replaced while the browser was starting
    this.timer = this.setTimer(() => {
      if (this.audio.currentTime >= snippet.end) this.stop();
    }, this.pollMs);
    return true;
  }

  stop(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.key !== null) {
      this.audio.pause();
      this.set(null);
    }
  }
}
