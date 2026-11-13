import { COAST_DECEL, COAST_HISTORY_MS, COAST_MIN_SPEED, SCRUB_SLOP_PX, secondsPerPx } from "./strip";

/** What the scrub needs from the outside: the song, the playback controller and the gate. All times are seconds. */
export interface ScrubHost {
  /** the song's position now */
  time(): number;
  duration(): number;
  /** how far forward the player may go (the first open question + grace, or the end) */
  limit(): number;
  /** CSS px width of the strip and seconds on each side of the centre */
  width(): number;
  halfWindow(): number;
  /** null: the game is busy (recovering) and cannot be scrubbed. wasPlaying: sound was running, or the game waits for an answer: resume after. */
  start(): { wasPlaying: boolean } | null;
  /** seek to t (limited again by the controller) and resume if it was playing; resolves when the seek is done */
  end(t: number, wasPlaying: boolean): Promise<unknown>;
  /** the drag hit the limit */
  onGate(): void;
  reducedMotion?(): boolean;
}

interface Point { x: number; at: number }

/**
 * The seek gesture on the strip as a state machine, driven by pointer events and a per-frame `frame(dt)`:
 * down → move past 6px (audio fades out and pauses) → the strip follows the finger 1:1 → up (coasts at the speed of the last 80 ms,
 * slowing 0.004 px/ms²) → settled: seek, then play again if it was playing. A tap does nothing.
 */
export class Scrub {
  /** null when idle; otherwise the time the strip shows */
  target: number | null = null;
  from = 0;
  /** the user's finger is down */
  held = false;
  private moved = false;
  private x0 = 0;
  private t0 = 0;
  private wasPlaying = false;
  private history: Point[] = [];
  private coast: { v: number } | null = null;
  private settling = false;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeActive = false;

  constructor(private readonly h: ScrubHost) {}

  /** the strip is showing something other than the song's position */
  get busy(): boolean {
    return this.target !== null;
  }

  private spp(): number {
    return secondsPerPx(this.h.halfWindow(), this.h.width());
  }

  private clamp(t: number): number {
    const max = Math.max(0, Math.min(this.h.limit(), this.h.duration()));
    if (t > max) { this.h.onGate(); return max; }
    return Math.max(0, t);
  }

  down(x: number, at: number): void {
    if (this.settling || this.nudgeActive) return;
    this.held = true;
    this.moved = this.coast !== null; // grabbing a coasting strip keeps the scrub going
    this.x0 = x;
    this.t0 = this.coast && this.target !== null ? this.target : this.h.time();
    this.coast = null;
    this.history = [{ x, at }];
  }

  move(x: number, at: number): void {
    if (!this.held) return;
    const dx = x - this.x0;
    if (!this.moved) {
      if (Math.abs(dx) < SCRUB_SLOP_PX) return;
      const s = this.h.start();
      if (!s) { this.held = false; return; }
      this.moved = true;
      this.wasPlaying = s.wasPlaying;
      this.from = this.t0;
    }
    if (this.target === null) this.target = this.t0;
    this.target = this.clamp(this.t0 - dx * this.spp());
    this.history.push({ x, at });
    if (this.history.length > 6) this.history.shift();
  }

  up(at: number): void {
    if (!this.held) return;
    this.held = false;
    if (!this.moved || this.target === null) return; // a tap does nothing
    const first = this.history[0], last = this.history[this.history.length - 1];
    let v = 0;
    if (first && last && last.at > first.at && at - last.at <= COAST_HISTORY_MS && !this.h.reducedMotion?.()) v = (last.x - first.x) / (last.at - first.at);
    if (Math.abs(v) < COAST_MIN_SPEED) this.commit();
    else this.coast = { v };
  }

  cancel(): void {
    if (!this.held) return;
    this.held = false;
    if (this.moved && this.target !== null) this.commit();
  }

  /** a keyboard or wheel nudge: seconds, accumulated while the key repeats, committed shortly after the last one */
  nudge(seconds: number): void {
    if (this.settling || this.held || this.coast) return;
    if (this.target === null) {
      const s = this.h.start();
      if (!s) return;
      this.wasPlaying = s.wasPlaying;
      this.from = this.h.time();
      this.target = this.from;
    }
    this.nudgeActive = true;
    this.target = this.clamp(this.target + seconds);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => { this.nudgeActive = false; this.nudgeTimer = null; this.commit(); }, 220);
  }

  jump(t: number): void { // Home / End
    if (this.target === null) this.nudge(0);
    if (this.target === null) return;
    this.target = this.clamp(t);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeActive = true;
    this.nudgeTimer = setTimeout(() => { this.nudgeActive = false; this.nudgeTimer = null; this.commit(); }, 220);
  }

  /** advance the coast by dt ms */
  frame(dt: number): void {
    const c = this.coast;
    if (!c || this.target === null) return;
    const mag = Math.abs(c.v) - COAST_DECEL * dt;
    const sign = Math.sign(c.v);
    let t = this.target - c.v * dt * this.spp();
    let hit = false;
    const max = Math.max(0, Math.min(this.h.limit(), this.h.duration()));
    if (t > max) { t = max; hit = true; this.h.onGate(); }
    if (t < 0) { t = 0; hit = true; }
    this.target = t;
    if (mag <= COAST_MIN_SPEED / 5 || hit) { this.coast = null; this.commit(); }
    else c.v = sign * mag;
  }

  private commit(): void {
    if (this.target === null) return;
    const t = this.target;
    this.settling = true;
    this.moved = false;
    void Promise.resolve(this.h.end(t, this.wasPlaying)).catch(() => undefined).finally(() => {
      this.settling = false;
      this.target = null;
    });
  }

  dispose(): void {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
  }
}
