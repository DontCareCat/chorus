import type { EngineState, GameEngine, Unsubscribe } from "./engine";

const SEEK_TIMEOUT_MS = 12_000;
const PLAY_TIMEOUT_MS = 10_000;
const STEP_MS = 50; // fades step the player's volume (0..100) this often
const SEEK_TOLERANCE_S = 0.4;
const MAX_LEAD_S = 0.6; // the interpolated clock is never further than this ahead of the player's last report

/** The part of the YouTube IFrame player the engine uses (the real one is `YT.Player`). */
export interface YtPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setVolume(volume: number): void;
  destroy(): void;
}

/** YT.PlayerState values */
export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 } as const;

/** What the IFrame player's error codes mean to a person. */
export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2: return "This YouTube link is not valid.";
    case 5: return "YouTube's player could not play this video here.";
    case 100: return "This video can't be played outside YouTube: it was removed or is private.";
    case 101: case 150: return "This video can't be played outside YouTube: its owner does not allow it.";
    case 152: case 153: return "This video can't be played here: YouTube's player refused to start (configuration error).";
    default: return `YouTube's player stopped with error ${code}.`;
  }
}

interface Fade {
  from: number;
  to: number;
  start: number;
  duration: number;
  timer: ReturnType<typeof setInterval>;
  resolve: (done: boolean) => void;
}

/**
 * The game's playback on a YouTube video, through YouTube's own IFrame player (documented API calls only).
 * The player reports its position in small steps, so the clock is interpolated between reads (never backwards while playing).
 * Time freezes while YouTube buffers or plays an ad, so the game simply waits with it. Feed the player's events to
 * `handleState` and `handleError`.
 */
export class YouTubePlaybackEngine implements GameEngine {
  private fadeValue = 1;
  private masterValue = 1;
  private fade: Fade | null = null;
  private state: EngineState = "idle";
  private lastRead = 0;
  private lastReadAt = 0;
  private clock = 0; // the last position we reported
  private readonly stateCbs = new Set<(s: EngineState) => void>();
  private readonly errorCbs = new Set<(m: string) => void>();
  private readonly waiters = new Set<() => void>();
  private readonly cancels = new Set<() => void>();
  private seekTarget: number | null = null; // while a seek is on its way the player still reports the old position

  constructor(private readonly player: YtPlayerLike, private readonly now: () => number = () => performance.now()) {
    this.apply();
  }

  handleState(code: number): void {
    const next: EngineState = code === YT_STATE.playing ? "playing" : code === YT_STATE.buffering ? "buffering" : code === YT_STATE.ended ? "ended" : code === YT_STATE.paused || code === YT_STATE.cued ? "paused" : "idle";
    if (next === "playing" || next === "paused") this.sync();
    if (next !== this.state) {
      this.state = next;
      this.stateCbs.forEach((cb) => cb(next));
    }
    this.waiters.forEach((w) => w());
  }

  handleError(code: number): void {
    this.errorCbs.forEach((cb) => cb(youtubeErrorMessage(code)));
  }

  /** Wait for `test`. The time limit only runs while the player is NOT buffering: an ad or a slow connection is a hold, not a failure. */
  private waitUntil(test: () => boolean, ms: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (test()) return resolve();
      let deadline = this.now() + ms;
      const finish = (error?: Error) => { clearInterval(timer); this.waiters.delete(check); this.cancels.delete(cancel); error ? reject(error) : resolve(); };
      const cancel = () => { clearInterval(timer); this.waiters.delete(check); };
      const check = () => {
        if (test()) return finish();
        if (this.state === "buffering") deadline = this.now() + ms;
        else if (this.now() >= deadline) finish(new Error(`${what} timed out`));
      };
      const timer = setInterval(check, 50); // the player has no event for "the position arrived"
      this.waiters.add(check);
      this.cancels.add(cancel);
    });
  }

  play(): Promise<void> {
    this.player.playVideo();
    return this.waitUntil(() => this.state === "playing", PLAY_TIMEOUT_MS, "play"); // rejects when the browser blocked the start
  }
  pause(): void {
    this.player.pauseVideo();
    this.sync();
  }

  async seek(time: number): Promise<void> {
    const duration = this.getDuration();
    const target = Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(time, duration) : time);
    this.seekTarget = target;
    this.player.seekTo(target, true);
    this.lastRead = target; // the clock is there from now on: never reported as earlier or later than where we asked
    this.lastReadAt = this.now();
    this.clock = target;
    try {
      await this.waitUntil(() => Math.abs(this.player.getCurrentTime() - target) < SEEK_TOLERANCE_S && this.state !== "buffering" && this.state !== "idle", SEEK_TIMEOUT_MS, `seek to ${target}`);
    } finally {
      this.seekTarget = null;
    }
    this.sync();
  }

  /** Read the player and remember it. */
  private sync(): void {
    const t = this.player.getCurrentTime();
    if (Number.isFinite(t)) { this.lastRead = t; this.lastReadAt = this.now(); this.clock = t; }
  }

  getCurrentTime(): number {
    const t = this.player.getCurrentTime();
    if (!Number.isFinite(t)) return this.clock;
    if (this.seekTarget !== null && Math.abs(t - this.seekTarget) >= SEEK_TOLERANCE_S) return this.clock; // not there yet: the old position is not news
    const at = this.now();
    if (t !== this.lastRead) { // the player moved
      const backwards = t < this.clock - SEEK_TOLERANCE_S; // a real jump back (a seek) is followed; a small step back is not
      this.lastRead = t; this.lastReadAt = at;
      this.clock = this.state === "playing" && !backwards ? Math.max(this.clock, t) : t;
      return this.clock;
    }
    if (this.state === "playing") { // between the player's own steps
      const rate = this.getPlaybackRate() || 1;
      const ahead = Math.min((at - this.lastReadAt) / 1000, MAX_LEAD_S); // the player's own clock stopped (a stall, an ad): do not run on without it
      this.clock = Math.max(this.clock, this.lastRead + ahead * rate);
      const d = this.getDuration();
      if (d > 0) this.clock = Math.min(this.clock, d);
    }
    return this.clock;
  }
  getDuration(): number {
    const d = this.player.getDuration();
    return Number.isFinite(d) && d > 0 ? d : NaN;
  }
  getPlaybackRate(): number {
    return this.player.getPlaybackRate() || 1;
  }

  private apply(): void {
    this.player.setVolume(Math.round(Math.min(1, Math.max(0, this.getVolume() * this.masterValue)) * 100));
  }

  getVolume(): number {
    const f = this.fade;
    if (!f) return this.fadeValue;
    const p = f.duration > 0 ? Math.min(1, Math.max(0, (this.now() - f.start) / f.duration)) : 1;
    return f.from + (f.to - f.from) * p;
  }
  setMasterVolume(volume: number): void {
    this.masterValue = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.apply();
  }
  getMasterVolume(): number {
    return this.masterValue;
  }
  /** The player gives no access to its audio: the level the volume stages let through is the estimate. */
  getOutputLevel(): number {
    return this.state === "playing" ? this.getVolume() * this.masterValue : 0;
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
    this.fadeValue = frozen;
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
        from, to, start: this.now(), duration: durationMs, resolve,
        timer: setInterval(() => {
          if (this.fade !== fade) return;
          this.apply();
          if (this.now() - fade.start >= durationMs) {
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
    this.waiters.clear();
    this.cancels.forEach((c) => c());
    this.cancels.clear();
    try { this.player.destroy(); } catch { /* already gone */ }
  }
}
