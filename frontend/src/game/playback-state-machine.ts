/**
 * The single authoritative playback state machine, as a PURE reducer: (state, event) → (state, effects).
 * It performs no I/O; PlaybackController executes the effects against a PlaybackEngine.
 *
 *   IDLE ──PLAY──▶ PLAYING ──OVERDUE──▶ FADING_OUT ──FADE_DONE──▶ SEEKING ──SEEK_DONE──▶ PAUSED_FOR_QUESTION
 *                     ▲                     │ ANSWERED (cancel fade)                              │ ANSWERED
 *                     │                     ▼                                                     ▼
 *                     └────FADE_DONE──── FADING_IN ◀───────────────────────────────────────────────┘
 *   PLAYING/FADING_IN ──USER_PAUSE──▶ PAUSED ──PLAY──▶ PLAYING;   any ──ERROR──▶ ERROR ──PLAY──▶ PLAYING
 */
export type PlaybackStateName =
  | "IDLE"
  | "PLAYING"
  | "PAUSED"
  | "FADING_OUT"
  | "SEEKING"
  | "PAUSED_FOR_QUESTION"
  | "FADING_IN"
  | "ERROR";

export interface MachineState {
  name: PlaybackStateName;
  /** Id of the question blocking playback (set from OVERDUE until playback resumes). */
  blockingId: number | null;
  /** Recovery position to seek to. */
  target: number | null;
  /** The blocking question was answered while the seek was still running. */
  resumeAfterSeek: boolean;
  /** The blocking question changed while seeking; seek again to `target` when done. */
  reseek: boolean;
  error: string | null;
}

export interface NextBlocking {
  questionId: number;
  target: number;
}

export type MachineEvent =
  | { type: "PLAY" }
  | { type: "USER_PAUSE" }
  /** The earliest unanswered question is overdue. `ended`: audio already ran out, so there is nothing to fade. */
  | { type: "OVERDUE"; questionId: number; target: number; ended: boolean }
  | { type: "FADE_DONE" }
  | { type: "SEEK_DONE" }
  | { type: "SEEK_FAILED"; message: string }
  /** A question was answered. `next` = the new earliest unanswered question if it is overdue as well, else null. */
  | { type: "ANSWERED"; questionId: number; next: NextBlocking | null }
  /** The audio ended and no question is blocking. */
  | { type: "ENDED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

export type Effect =
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; time: number }
  | { type: "fadeOut" }
  | { type: "fadeIn" }
  | { type: "cancelFade" }
  | { type: "setVolume"; volume: number };

export interface Transition {
  state: MachineState;
  effects: Effect[];
}

export const initialState: MachineState = {
  name: "IDLE",
  blockingId: null,
  target: null,
  resumeAfterSeek: false,
  reseek: false,
  error: null,
};

const same = (state: MachineState): Transition => ({ state, effects: [] });
const to = (state: MachineState, patch: Partial<MachineState>, effects: Effect[] = []): Transition => ({
  state: { ...state, ...patch },
  effects,
});
const playing = (state: MachineState, effects: Effect[]): Transition =>
  to(state, { name: "PLAYING", blockingId: null, target: null, resumeAfterSeek: false, reseek: false, error: null }, effects);

export function transition(state: MachineState, event: MachineEvent): Transition {
  if (event.type === "ERROR") {
    return to(state, { name: "ERROR", error: event.message }, [{ type: "cancelFade" }, { type: "pause" }]);
  }
  if (event.type === "RESET") return { state: initialState, effects: [{ type: "cancelFade" }, { type: "pause" }] };

  switch (state.name) {
    case "IDLE":
    case "PAUSED":
    case "ERROR":
      if (event.type === "PLAY") return playing(state, [{ type: "setVolume", volume: 1 }, { type: "play" }]);
      return same(state);

    case "PLAYING":
      switch (event.type) {
        case "USER_PAUSE":
          return to(state, { name: "PAUSED" }, [{ type: "pause" }]);
        case "OVERDUE":
          if (event.ended) {
            // Audio already ran out: nothing to fade, go straight to the recovery seek.
            return to(
              state,
              { name: "SEEKING", blockingId: event.questionId, target: event.target, resumeAfterSeek: false, reseek: false, },
              [{ type: "setVolume", volume: 0 }, { type: "pause" }, { type: "seek", time: event.target }],
            );
          }
          return to(state, { name: "FADING_OUT", blockingId: event.questionId, target: event.target }, [{ type: "fadeOut" }]);
        case "ENDED":
          return to(state, { name: "IDLE" });
        default:
          return same(state);
      }

    case "FADING_OUT":
      switch (event.type) {
        case "FADE_DONE":
          return to(state, { name: "SEEKING", resumeAfterSeek: false, reseek: false }, [
            { type: "pause" },
            { type: "seek", time: state.target ?? 0 },
          ]);
        case "ANSWERED":
          if (event.questionId !== state.blockingId) return same(state);
          if (event.next === null) {
            // Answered mid fade-out: abort the recovery, fade back up from wherever the gain is now.
            return to(state, { name: "FADING_IN", blockingId: null, target: null }, [{ type: "cancelFade" }, { type: "fadeIn" }]);
          }
          return to(state, { blockingId: event.next.questionId, target: event.next.target });
        default:
          return same(state); // OVERDUE while recovering is ignored: recovery is idempotent
      }

    case "SEEKING":
      switch (event.type) {
        case "SEEK_DONE":
          if (state.resumeAfterSeek) {
            return to(state, { name: "FADING_IN", blockingId: null, target: null, resumeAfterSeek: false, reseek: false }, [
              { type: "play" },
              { type: "fadeIn" },
            ]);
          }
          if (state.reseek) return to(state, { reseek: false }, [{ type: "seek", time: state.target ?? 0 }]);
          return to(state, { name: "PAUSED_FOR_QUESTION" });
        case "SEEK_FAILED":
          return to(state, { name: "ERROR", error: event.message }, [{ type: "pause" }]);
        case "ANSWERED":
          if (event.questionId !== state.blockingId) return same(state);
          if (event.next === null) return to(state, { resumeAfterSeek: true });
          return to(state, { blockingId: event.next.questionId, target: event.next.target, reseek: true });
        default:
          return same(state);
      }

    case "PAUSED_FOR_QUESTION":
      if (event.type === "PLAY") {
        // The player may listen again without answering. The question is still open, so the normal 3-second
        // rule applies: once the audio runs past the deadline it fades out, rewinds and waits again.
        return playing(state, [{ type: "setVolume", volume: 1 }, { type: "play" }]);
      }
      if (event.type === "ANSWERED" && event.questionId === state.blockingId) {
        if (event.next === null) {
          return to(state, { name: "FADING_IN", blockingId: null, target: null }, [{ type: "play" }, { type: "fadeIn" }]);
        }
        // Another question is still blocking: stay paused, move to its recovery position.
        return to(
          state,
          { name: "SEEKING", blockingId: event.next.questionId, target: event.next.target, resumeAfterSeek: false, reseek: false },
          [{ type: "seek", time: event.next.target }],
        );
      }
      return same(state); // USER_PAUSE / answers to other questions change nothing while waiting

    case "FADING_IN":
      switch (event.type) {
        case "FADE_DONE":
          return playing(state, []);
        case "OVERDUE":
          return to(state, { name: "FADING_OUT", blockingId: event.questionId, target: event.target }, [
            { type: "cancelFade" },
            { type: "fadeOut" },
          ]);
        case "USER_PAUSE":
          return to(state, { name: "PAUSED" }, [{ type: "cancelFade" }, { type: "pause" }, { type: "setVolume", volume: 1 }]);
        case "ENDED":
          return to(state, { name: "IDLE" }, [{ type: "cancelFade" }, { type: "setVolume", volume: 1 }]);
        default:
          return same(state);
      }
  }
}
