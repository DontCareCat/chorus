import type { EngineState, PlaybackEngine, Unsubscribe } from "../../services/audio/engine";

interface Fade {
  from: number;
  to: number;
  ms: number;
  elapsed: number;
  resolve: (done: boolean) => void;
}

/** Deterministic PlaybackEngine for tests: time, fades and seeks only move when the test says so. */
export class FakePlaybackEngine implements PlaybackEngine {
  time = 0;
  duration = 240;
  rate = 1;
  playing = false;
  volume = 1;
  masterVolume = 1;
  holdSeeks = false; // seeks stay pending until releaseSeek()
  failNextSeek = false;
  rejectNextPlay = false;
  log: string[] = [];

  private fade: Fade | null = null;
  private pendingSeek: { time: number; resolve: () => void } | null = null;
  private stateCbs = new Set<(s: EngineState) => void>();
  private errorCbs = new Set<(m: string) => void>();

  get fading(): boolean {
    return this.fade !== null;
  }

  count(prefix: string): number {
    return this.log.filter((l) => l.startsWith(prefix)).length;
  }

  /** Advance real-time by `ms`: moves the playhead (if playing) and progresses a running fade. */
  advance(ms: number): void {
    if (this.playing) {
      this.time += (ms / 1000) * this.rate;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.playing = false;
        this.stateCbs.forEach((cb) => cb("ended"));
      }
    }
    const f = this.fade;
    if (f) {
      f.elapsed += ms;
      const p = Math.min(1, f.elapsed / f.ms);
      this.volume = f.from + (f.to - f.from) * p;
      if (p >= 1) {
        this.fade = null;
        f.resolve(true);
      }
    }
  }

  releaseSeek(): void {
    const s = this.pendingSeek;
    if (!s) return;
    this.pendingSeek = null;
    this.time = s.time;
    s.resolve();
  }

  async play(): Promise<void> {
    this.log.push("play");
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      throw new Error("NotAllowedError");
    }
    this.playing = true;
  }

  pause(): void {
    this.log.push("pause");
    this.playing = false;
  }

  seek(time: number): Promise<void> {
    this.log.push(`seek:${time}`);
    if (this.failNextSeek) {
      this.failNextSeek = false;
      return Promise.reject(new Error("seek failed"));
    }
    if (this.holdSeeks) {
      return new Promise((resolve) => {
        this.pendingSeek = { time, resolve };
      });
    }
    this.time = time;
    return Promise.resolve();
  }

  getCurrentTime(): number {
    return this.time;
  }
  getDuration(): number {
    return this.duration;
  }
  getPlaybackRate(): number {
    return this.rate;
  }

  private startFade(to: number, ms: number): Promise<boolean> {
    this.cancelFade();
    if (ms <= 0) {
      this.volume = to;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      this.fade = { from: this.volume, to, ms, elapsed: 0, resolve };
    });
  }

  fadeOut(ms: number): Promise<boolean> {
    this.log.push("fadeOut");
    return this.startFade(0, ms);
  }

  fadeIn(ms: number): Promise<boolean> {
    this.log.push("fadeIn");
    return this.startFade(1, ms);
  }

  cancelFade(): void {
    const f = this.fade;
    if (!f) return;
    this.log.push("cancelFade");
    this.fade = null; // gain stays exactly where it is: no jump
    f.resolve(false);
  }

  setVolume(v: number): void {
    this.log.push(`volume:${v}`);
    this.cancelFade();
    this.volume = v;
  }
  getVolume(): number {
    return this.volume;
  }
  setMasterVolume(v: number): void {
    this.masterVolume = v;
  }
  getMasterVolume(): number {
    return this.masterVolume;
  }

  onStateChange(cb: (s: EngineState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onError(cb: (m: string) => void): Unsubscribe {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }
}
