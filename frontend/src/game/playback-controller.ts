import type { PlaybackEngine } from "../services/audio/engine";
import { initialState, transition } from "./playback-state-machine";
import type { Effect, MachineEvent, MachineState, NextBlocking } from "./playback-state-machine";
import { getEarliestUnanswered, getRecoveryPosition, isOverdue, limitSeek, updateSynchronization } from "./synchronization";
import type { SyncQuestion } from "./synchronization";
import { FADE_IN_MS, FADE_OUT_MS, SYNC_GRACE_PERIOD } from "./timing";

/** What a player seek did: `clamped` = it was limited because an unanswered question cannot be skipped. */
export interface SeekOutcome {
  applied: boolean;
  clamped: boolean;
}

export interface ControllerOptions {
  engine: PlaybackEngine;
  getQuestions: () => readonly SyncQuestion[];
  getAnswered: () => ReadonlySet<number>;
  /** false → free play (unsynchronized lyrics): audio is never gated, faded or rewound. */
  gating?: boolean;
  fadeOutMs?: number;
  fadeInMs?: number;
  grace?: number;
  onChange?: (state: MachineState) => void;
}

/**
 * The single owner of playback. It feeds events into the pure state machine and executes the resulting effects
 * on the engine. The position always comes from engine.getCurrentTime(); `tick()` is merely a poll hook.
 */
export class PlaybackController {
  state: MachineState = initialState;
  private epoch = 0; // invalidates completions of superseded async effects (fades, seeks, play)
  private readonly gating: boolean;
  private readonly fadeOutMs: number;
  private readonly fadeInMs: number;
  private readonly grace: number;

  constructor(private readonly o: ControllerOptions) {
    this.gating = o.gating ?? true;
    this.fadeOutMs = o.fadeOutMs ?? FADE_OUT_MS;
    this.fadeInMs = o.fadeInMs ?? FADE_IN_MS;
    this.grace = o.grace ?? SYNC_GRACE_PERIOD;
  }

  play(): void {
    this.dispatch({ type: "PLAY" });
  }

  /**
   * Stop: silence the audio and go back to the beginning, from whatever state the game is in (playing, waiting
   * for an answer, errored, ...). Resets the controller first so no pending fade or recovery can interfere;
   * pressing play afterwards starts the song from the top.
   */
  stop(): void {
    this.dispatch({ type: "RESET" });
    const epoch = this.epoch;
    this.o.engine.setVolume(1); // RESET may have frozen a half-faded gain
    this.o.engine.seek(0).catch((err: unknown) => {
      if (epoch === this.epoch) this.dispatch({ type: "ERROR", message: `seek_failed: ${String(err)}` });
    });
  }

  /**
   * Go back `seconds` and carry on playing. Works while the game waits for an answer too: the audio simply plays
   * the part again, and the normal 3-second rule pauses it once more if the question is still unanswered.
   */
  rewind(seconds: number): void {
    const e = this.o.engine;
    const target = Math.max(0, e.getCurrentTime() - seconds);
    switch (this.state.name) {
      case "PLAYING":
      case "FADING_IN":
        void e.seek(target);
        return;
      case "FADING_OUT":
      case "SEEKING":
        return; // the game is busy rewinding itself
    }
    const epoch = this.epoch;
    e.seek(target).then(
      () => {
        if (epoch === this.epoch) this.play(); // nothing else happened in the meantime
      },
      (err: unknown) => {
        if (epoch === this.epoch) this.dispatch({ type: "ERROR", message: `seek_failed: ${String(err)}` });
      },
    );
  }

  pause(): void {
    this.dispatch({ type: "USER_PAUSE" });
  }

  reset(): void {
    this.dispatch({ type: "RESET" });
  }

  /**
   * A seek asked for by the player (timeline click, slider, arrow keys). Backwards is always fine; forwards stops at
   * the open question: an unanswered question cannot be skipped, so the seek is limited to its line instead of
   * running past it (which would only trigger a fade-out and rewind). While the game rewinds itself
   * (FADING_OUT / SEEKING) player seeks are ignored, so they cannot fight the controller's own seek.
   */
  userSeek(time: number): Promise<SeekOutcome> {
    const { name } = this.state;
    if (name === "FADING_OUT" || name === "SEEKING") return Promise.resolve({ applied: false, clamped: false });
    const here = this.o.engine.getCurrentTime();
    const requested = Math.max(0, time);
    const { target, clamped } = this.gating
      ? limitSeek({ requested, current: here, questions: this.o.getQuestions(), answered: this.o.getAnswered(), grace: this.grace })
      : { target: requested, clamped: false };
    if (Math.abs(target - here) < 0.05) return Promise.resolve({ applied: false, clamped });
    return this.o.engine.seek(target).then(
      () => ({ applied: true, clamped }),
      (err: unknown) => {
        this.dispatch({ type: "ERROR", message: `seek_failed: ${String(err)}` });
        return { applied: false, clamped };
      },
    );
  }

  /** Poll hook (~150 ms). Reads the real position; does nothing unless audio is actually running. */
  tick(): void {
    if (!this.gating) return;
    const { name } = this.state;
    if (name !== "PLAYING" && name !== "FADING_IN") return;
    const decision = updateSynchronization({
      currentTime: this.o.engine.getCurrentTime(),
      questions: this.o.getQuestions(),
      answered: this.o.getAnswered(),
      grace: this.grace,
    });
    if (decision.kind === "recover") {
      this.dispatch({ type: "OVERDUE", questionId: decision.question.id, target: decision.target, ended: false });
    }
  }

  /** Call when the engine reports the end of the audio. */
  notifyEnded(): void {
    const { name } = this.state;
    if (name !== "PLAYING" && name !== "FADING_IN") return;
    const decision = this.gating
      ? updateSynchronization({
          currentTime: this.o.engine.getCurrentTime(),
          ended: true,
          questions: this.o.getQuestions(),
          answered: this.o.getAnswered(),
          grace: this.grace,
        })
      : ({ kind: "ok" } as const);
    if (decision.kind === "recover") {
      this.dispatch({ type: "OVERDUE", questionId: decision.question.id, target: decision.target, ended: true });
    } else {
      this.dispatch({ type: "ENDED" });
    }
  }

  notifyError(message: string): void {
    this.dispatch({ type: "ERROR", message });
  }

  /** Call AFTER the question has been marked answered in the quiz state (getAnswered must already include it). */
  notifyAnswered(questionId: number): void {
    this.dispatch({ type: "ANSWERED", questionId, next: this.nextBlocking(questionId) });
  }

  /** If the earliest unanswered question is overdue as well, recovery continues with it. */
  private nextBlocking(answeredId: number): NextBlocking | null {
    const s = this.state;
    if (!this.gating || s.blockingId !== answeredId) return null;
    const blocked = ["FADING_OUT", "SEEKING", "PAUSED_FOR_QUESTION"];
    if (!blocked.includes(s.name)) return null;
    const q = getEarliestUnanswered(this.o.getQuestions(), this.o.getAnswered());
    if (q === null) return null;
    // While seeking, the engine position is in flux; the position we are heading to is what counts.
    const at = s.name === "SEEKING" ? (s.target ?? 0) : this.o.engine.getCurrentTime();
    return isOverdue(at, q, this.grace) ? { questionId: q.id, target: getRecoveryPosition(q) } : null;
  }

  private dispatch(event: MachineEvent): void {
    const { state, effects } = transition(this.state, event);
    const changed = state !== this.state;
    this.state = state;
    if (effects.some((e) => e.type !== "setVolume")) this.epoch++;
    const epoch = this.epoch;
    for (const effect of effects) this.run(effect, epoch);
    if (changed) this.o.onChange?.(state);
  }

  private run(effect: Effect, epoch: number): void {
    const e = this.o.engine;
    const guard = (fn: () => void) => () => {
      if (epoch === this.epoch) fn();
    };
    switch (effect.type) {
      case "setVolume":
        e.setVolume(effect.volume);
        break;
      case "cancelFade":
        e.cancelFade();
        break;
      case "pause":
        e.pause();
        break;
      case "play":
        e.play().catch((err: unknown) => guard(() => this.dispatch({ type: "ERROR", message: `play_rejected: ${String(err)}` }))());
        break;
      case "seek":
        e.seek(effect.time).then(
          guard(() => this.dispatch({ type: "SEEK_DONE" })),
          (err: unknown) => guard(() => this.dispatch({ type: "SEEK_FAILED", message: String(err) }))(),
        );
        break;
      case "fadeOut":
        e.fadeOut(this.fadeOutMs).then((done) => done && guard(() => this.dispatch({ type: "FADE_DONE" }))());
        break;
      case "fadeIn":
        e.fadeIn(this.fadeInMs).then((done) => done && guard(() => this.dispatch({ type: "FADE_DONE" }))());
        break;
    }
  }
}
