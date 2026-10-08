import type { EngineState, GameEngine, Unsubscribe } from "./engine";

const SEEK_TIMEOUT_MS = 8000;
const STEP_MS = 20;

interface Fade {
  from: number;
  to: number;
  start: number; // performance.now()
  duration: number; // ms
  timer: ReturnType<typeof setInterval>;
  resolve: (done: boolean) => void;
}

/**
 * "Direct audio": the plain <audio> element with no Web Audio graph, exactly the path the song page's preview uses.
 * Fades step the element's own volume every 20 ms, so they are a little coarser than the Web Audio ramps, and iOS
 * ignores the volume property (fades become hard stops there). Offered in Settings for devices where the Web Audio
 * output sounds distorted.
 */
export class HtmlAudioPlaybackEngine implements GameEngine {
  private fadeValue = 1;
  private masterValue = 1;
  private fade: Fade | null = null;
  private readonly stateCbs = new Set<(s: EngineState) => void>();
  private readonly errorCbs = new Set<(m: string) => void>();
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly audio: HTMLAudioElement) {
    this.apply();
    const on = (type: string, fn: () => void) => {
      audio.addEventListener(type, fn);
      this.cleanup.push(() => audio.removeEventListener(type, fn));
    };
    const emit = (s: EngineState) => this.stateCbs.forEach((cb) => cb(s));
    on("playing", () => emit("playing"));
    on("pause", () => emit(audio.ended ? "ended" : "paused"));
    on("waiting", () => emit("buffering"));
    on("ended", () => emit("ended"));
    on("error", () => this.errorCbs.forEach((cb) => cb(audio.error?.message || "audio error")));
  }

  private apply(): void {
    this.audio.volume = Math.min(1, Math.max(0, this.getVolume() * this.masterValue));
  }

  async play(): Promise<void> {
    await this.audio.play();
  }
  pause(): void {
    this.audio.pause();
  }

  seek(time: number): Promise<void> {
    const target = Math.max(0, Number.isFinite(this.audio.duration) ? Math.min(time, this.audio.duration) : time);
    return new Promise((resolve, reject) => {
      if (Math.abs(this.audio.currentTime - target) < 0.01 && !this.audio.seeking) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.audio.removeEventListener("seeked", onSeeked);
        reject(new Error(`seek to ${target} timed out`));
      }, SEEK_TIMEOUT_MS);
      const onSeeked = () => {
        clearTimeout(timer);
        resolve();
      };
      this.audio.addEventListener("seeked", onSeeked, { once: true });
      this.audio.currentTime = target;
    });
  }

  getCurrentTime(): number {
    return this.audio.currentTime;
  }
  getDuration(): number {
    return this.audio.duration;
  }
  getPlaybackRate(): number {
    return this.audio.playbackRate;
  }

  /** The fade gain right now, computed from the running ramp. */
  getVolume(): number {
    const f = this.fade;
    if (!f) return this.fadeValue;
    const p = f.duration > 0 ? Math.min(1, Math.max(0, (performance.now() - f.start) / f.duration)) : 1;
    return f.from + (f.to - f.from) * p;
  }

  setMasterVolume(volume: number): void {
    this.masterValue = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.apply();
  }
  getMasterVolume(): number {
    return this.masterValue;
  }

  /** There is no analyser on this path: the level the volume stages let through is the best estimate. */
  getOutputLevel(): number {
    return this.audio.paused ? 0 : this.getVolume() * this.masterValue;
  }

  fadeOut(durationMs: number): Promise<boolean> {
    return this.startFade(0, durationMs);
  }
  fadeIn(durationMs: number): Promise<boolean> {
    return this.startFade(1, durationMs);
  }

  cancelFade(): void {
    const f = this.fade;
    if (!f) return;
    const frozen = this.getVolume();
    clearInterval(f.timer);
    this.fade = null;
    this.fadeValue = frozen; // freeze exactly where the ramp was: no jump
    this.apply();
    f.resolve(false);
  }

  setVolume(volume: number): void {
    this.cancelFade();
    this.fadeValue = volume;
    this.apply();
  }

  private startFade(to: number, durationMs: number): Promise<boolean> {
    const from = this.getVolume();
    this.cancelFade();
    this.fadeValue = from;
    if (durationMs <= 0 || from === to) {
      this.fadeValue = to;
      this.apply();
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const fade: Fade = {
        from, to, start: performance.now(), duration: durationMs, resolve,
        timer: setInterval(() => {
          if (this.fade !== fade) return;
          this.apply();
          if (performance.now() - fade.start >= durationMs) {
            clearInterval(fade.timer);
            this.fade = null;
            this.fadeValue = to;
            this.apply();
            resolve(true);
          }
        }, STEP_MS),
      };
      this.fade = fade;
    });
  }

  onStateChange(cb: (s: EngineState) => void): Unsubscribe {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onError(cb: (m: string) => void): Unsubscribe {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  dispose(): void {
    this.cancelFade();
    this.cleanup.forEach((fn) => fn());
  }
}
