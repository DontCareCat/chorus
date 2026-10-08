import type { EngineState, PlaybackEngine, Unsubscribe } from "./engine";

const SEEK_TIMEOUT_MS = 8000;

interface Fade {
  from: number;
  to: number;
  start: number; // AudioContext time
  duration: number; // seconds
  timer: ReturnType<typeof setTimeout>;
  resolve: (done: boolean) => void;
}

/**
 * Production engine: a local <audio> element routed through Web Audio
 *
 *   <audio> → MediaElementAudioSourceNode → fade GainNode → master GainNode → AnalyserNode → destination
 *
 * The fade gain is owned by the game (smooth ramps at the 3-second rule); the master gain is the player's volume
 * setting. Two stages, so neither can override the other.
 *
 * Fades use AudioParam automation on the audio clock (linearRampToValueAtTime), always anchored at the current
 * gain so an interrupted fade never jumps. The audio must be same-origin (served by our backend).
 */
export class WebAudioPlaybackEngine implements PlaybackEngine {
  private readonly gain: GainNode;
  private readonly master: GainNode;
  private masterValue = 1;
  private readonly analyser: AnalyserNode;
  private readonly source: MediaElementAudioSourceNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private lastValue = 1; // gain when no fade is running
  private fade: Fade | null = null;
  private readonly stateCbs = new Set<(s: EngineState) => void>();
  private readonly errorCbs = new Set<(m: string) => void>();
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly ctx: AudioContext,
  ) {
    this.source = ctx.createMediaElementSource(audio);
    this.gain = ctx.createGain();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.gain);
    this.gain.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.gain.gain.setValueAtTime(1, ctx.currentTime);
    this.master.gain.setValueAtTime(1, ctx.currentTime);

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

  async play(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume(); // needs a user gesture
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

  /** Gain right now, computed from the running ramp (not read back from the AudioParam). */
  getVolume(): number {
    const f = this.fade;
    if (!f) return this.lastValue;
    const p = f.duration > 0 ? Math.min(1, Math.max(0, (this.ctx.currentTime - f.start) / f.duration)) : 1;
    return f.from + (f.to - f.from) * p;
  }

  setMasterVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.masterValue = v;
    // a short exponential approach (~60 ms to settle) instead of a jump: no zipper noise or click while dragging
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }
  getMasterVolume(): number {
    return this.masterValue;
  }

  /** RMS of what is actually leaving the gain node, 0..1 (for the level meter and for verification). */
  getOutputLevel(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const v of this.samples) sum += v * v;
    return Math.sqrt(sum / this.samples.length);
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
    clearTimeout(f.timer);
    this.fade = null;
    this.anchor(frozen); // freeze exactly where the ramp was: no jump
    f.resolve(false);
  }

  setVolume(volume: number): void {
    this.cancelFade();
    this.anchor(volume);
  }

  private anchor(value: number): void {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(value, now);
    this.lastValue = value;
  }

  private startFade(to: number, durationMs: number): Promise<boolean> {
    const from = this.getVolume();
    this.cancelFade();
    this.anchor(from);
    if (durationMs <= 0 || from === to) {
      this.anchor(to);
      return Promise.resolve(true);
    }
    const now = this.ctx.currentTime;
    this.gain.gain.linearRampToValueAtTime(to, now + durationMs / 1000);
    return new Promise<boolean>((resolve) => {
      const fade: Fade = {
        from, to, start: now, duration: durationMs / 1000, resolve,
        timer: setTimeout(() => {
          if (this.fade !== fade) return;
          this.fade = null;
          this.lastValue = to;
          resolve(true);
        }, durationMs),
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
    this.source.disconnect();
    this.gain.disconnect();
    this.master.disconnect();
    this.analyser.disconnect();
  }
}
