import { useCallback, useEffect, useRef, useState } from "react";
import { PlaybackController } from "../game/playback-controller";
import type { SeekOutcome } from "../game/playback-controller";
import type { MachineState } from "../game/playback-state-machine";
import { initialState } from "../game/playback-state-machine";
import type { SyncQuestion } from "../game/synchronization";
import { POLL_INTERVAL_MS } from "../game/timing";
import type { PlaybackEngine } from "../services/audio/engine";

export interface UsePlaybackSyncOptions {
  engine: PlaybackEngine | null;
  /** Questions that gate playback (empty / gating=false → free play). */
  questions: readonly SyncQuestion[];
  /** Ids already answered (persisted answers). Optimistic answers are tracked inside the hook. */
  answered: ReadonlySet<number>;
  gating: boolean;
  pollMs?: number;
}

export interface PlaybackSync {
  state: MachineState;
  controller: PlaybackController | null;
  play: () => void;
  pause: () => void;
  seek: (time: number) => Promise<SeekOutcome>;
  /** Silence the audio and go back to the beginning, whatever the state. */
  stop: () => void;
  /** Go back this many seconds and carry on playing (also while the game waits for an answer). */
  rewind: (seconds: number) => void;
  /** Mark a question answered NOW (optimistic) and tell the controller. Never waits for the network. */
  markAnswered: (questionId: number) => void;
}

/**
 * Thin React glue around PlaybackController: owns the poll timer and engine event wiring.
 * All decisions live in the controller / pure modules.
 */
export function usePlaybackSync(opts: UsePlaybackSyncOptions): PlaybackSync {
  const { engine, gating, pollMs = POLL_INTERVAL_MS } = opts;
  const questionsRef = useRef(opts.questions);
  questionsRef.current = opts.questions;
  // Union of persisted and optimistic answers; the controller reads this ref, so it is always current.
  const answeredRef = useRef(new Set<number>());
  for (const id of opts.answered) answeredRef.current.add(id);

  const [state, setState] = useState<MachineState>(initialState);
  const [controller, setController] = useState<PlaybackController | null>(null);

  useEffect(() => {
    if (!engine) return;
    const c = new PlaybackController({
      engine,
      gating,
      getQuestions: () => questionsRef.current,
      getAnswered: () => answeredRef.current,
      onChange: setState,
    });
    setController(c);
    setState(c.state);
    const timer = setInterval(() => c.tick(), pollMs);
    const offState = engine.onStateChange((s) => {
      if (s === "ended") c.notifyEnded();
    });
    const offError = engine.onError((m) => c.notifyError(m));
    return () => {
      clearInterval(timer);
      offState();
      offError();
      c.reset();
      setController(null);
    };
  }, [engine, gating, pollMs]);

  const play = useCallback(() => controller?.play(), [controller]);
  const pause = useCallback(() => controller?.pause(), [controller]);
  const seek = useCallback((t: number) => controller?.userSeek(t) ?? Promise.resolve({ applied: false, clamped: false }), [controller]);
  const stop = useCallback(() => controller?.stop(), [controller]);
  const rewind = useCallback((seconds: number) => controller?.rewind(seconds), [controller]);
  const markAnswered = useCallback(
    (id: number) => {
      answeredRef.current.add(id);
      controller?.notifyAnswered(id);
    },
    [controller],
  );

  return { state, controller, play, pause, seek, stop, rewind, markAnswered };
}
