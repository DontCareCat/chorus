import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { Question, resultWord } from "../components/Question";
import { Runway } from "../components/Runway";
import { Sheet } from "../components/Sheet";
import { Transport } from "../components/Transport";
import { computeRunway } from "../game/runway";
import { describeStatus } from "../game/status";
import { useAsync } from "../hooks/useAsync";
import { useGame } from "../hooks/useGame";
import { useVolume } from "../hooks/useVolume";
import { usePlaybackSync } from "../hooks/usePlaybackSync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api } from "../services/api";
import type { PlaybackEngine } from "../services/audio/engine";
import { WebAudioPlaybackEngine } from "../services/audio/web-audio-engine";
import type { QuestionResult } from "../hooks/useGame";
import type { GameDto } from "../types/game";
import type { QuizQuestion as QuizQuestionT } from "../types/question";

const LAST_ANSWER_MS = 4000; // how long the result line of the previous answer stays visible

export function GamePage({ publicId }: { publicId: string }) {
  const game = useAsync(() => api.getGame(publicId), [publicId]);
  if (game.error) return <p className="notice error">{game.error.status === 404 ? en.game.notFound : game.error.message}</p>;
  if (!game.data) return <p className="muted">…</p>;
  return <GameScreen game={game.data} />;
}

function GameScreen({ game }: { game: GameDto }) {
  const g = useGame(game);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [engine, setEngine] = useState<WebAudioPlaybackEngine | null>(null);
  const [wantPlay, setWantPlay] = useState(false);
  const [manualFocus, setManualFocus] = useState<number | null>(null);
  const [, setFrame] = useState(0);
  const [lastAnswered, setLastAnswered] = useState<number | null>(null);
  const lastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const vol = useVolume(engine as PlaybackEngine | null);
  const playback = usePlaybackSync({ engine: engine as PlaybackEngine | null, questions: g.syncQs, answered: g.answeredSet, gating: g.synced });

  const [audioFailed, setAudioFailed] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A seek asked for by the player. Resolves when done. An open question cannot be skipped: if the request went
   *  past it, it was limited and the player is told why. */
  const seekTo = useCallback(
    async (t: number) => {
      const end = engine?.getDuration();
      const outcome = await playback.seek(Math.max(0, Number.isFinite(end) && end ? Math.min(t, end) : t));
      if (outcome.clamped) {
        setHint(en.game.cannotSkip);
        clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(null), 3500);
      }
      return outcome;
    },
    [engine, playback],
  );

  // Start playing once the engine exists AND its controller is ready (first click is the user gesture).
  useEffect(() => {
    if (wantPlay && playback.controller) {
      playback.play();
      setWantPlay(false);
    }
  }, [wantPlay, playback]);

  // 10 Hz redraw for the runway / clock; positions are always read from the engine.
  useEffect(() => {
    const t = setInterval(() => setFrame((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => { clearTimeout(lastTimer.current); clearTimeout(hintTimer.current); }, []);
  useEffect(
    () => () => {
      engine?.dispose();
    },
    [engine],
  );

  const firstOpen = useMemo(() => g.quiz.find((q) => !g.answeredSet.has(q.id)) ?? null, [g.quiz, g.answeredSet]);
  const focusedQ = g.quiz.find((q) => q.id === manualFocus) ?? firstOpen ?? g.quiz[g.quiz.length - 1] ?? null;
  const focusedIndex = focusedQ ? g.quiz.indexOf(focusedQ) : -1;
  const siblings = useMemo(() => (focusedQ ? g.quiz.filter((x) => x.lineId === focusedQ.lineId) : []), [g.quiz, focusedQ]);

  const time = engine?.getCurrentTime() ?? 0;
  // Until the audio element knows its length, the API's duration keeps the runway meaningful.
  const engineDuration = engine?.getDuration() ?? NaN;
  const duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : game.song_duration;
  const runway = computeRunway({ duration, currentTime: time, questions: g.syncQs, answered: g.answeredSet });
  const status = describeStatus({ state: playback.state.name, error: playback.state.error, runway: g.synced ? runway : null, freePlay: !g.synced });

  /** Choosing a line from the lyric sheet (far below the question) also brings its question into view. */
  const focusFromSheet = useCallback((id: number) => {
    setManualFocus(id);
    requestAnimationFrame(() =>
      document.querySelector(".prompt-wrap")?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      }),
    );
  }, []);

  const answer = useCallback(
    (q: (typeof g.quiz)[number], optionId: number) => {
      g.answer(q.id, optionId, () => playback.markAnswered(q.id));
      // The next open question (after this one, else the first open one) appears at once; the result of this
      // answer shows in a line of its own and in the lyric sheet. With nothing left, this question stays up.
      const after = g.quiz.slice(g.quiz.indexOf(q) + 1).find((x) => !g.answeredSet.has(x.id) && x.id !== q.id);
      const next = after ?? g.quiz.find((x) => !g.answeredSet.has(x.id) && x.id !== q.id) ?? null;
      setManualFocus(next ? next.id : q.id);
      setLastAnswered(q.id);
      clearTimeout(lastTimer.current);
      lastTimer.current = setTimeout(() => setLastAnswered(null), LAST_ANSWER_MS);
    },
    [g, playback],
  );

  // Keyboard: 1–4 pick an answer for the focused question.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && engine) {
        e.preventDefault();
        void seekTo(engine.getCurrentTime() + (e.key === "ArrowRight" ? 5 : -5));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        vol.step(e.key === "ArrowUp" ? 1 : -1);
        return;
      }
      if (e.key === "m" || e.key === "M") {
        vol.toggleMute();
        return;
      }
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      const o = i >= 0 && focusedQ ? focusedQ.options[i] : undefined;
      if (focusedQ && o && !g.answeredSet.has(focusedQ.id)) answer(focusedQ, o.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedQ, g.answeredSet, answer, engine, seekTo, vol.step, vol.toggleMute]);

  const start = () => {
    if (!audioRef.current || engine) return;
    setEngine(new WebAudioPlaybackEngine(audioRef.current, new AudioContext()));
    setWantPlay(true);
  };
  const stop = () => playback.stop();
  const back5 = () => playback.rewind(5);
  useEffect(() => {
    if (engine) (window as unknown as { __chorus: unknown }).__chorus = { engine, controller: playback.controller };
  }, [engine, playback.controller]);

  return (
    <>
      <div className="game-head">
        <Cover songId={game.song_id} hasCover={null} size="large" />
        <div className="game-title">
          <a className="crumb" href={paths.library()}>{en.game.backToLibrary}</a>
          <h1>{game.song_title}</h1>
          <p className="muted">{[game.song_artist, en.library.difficulty[game.difficulty] ?? game.difficulty, game.language].filter(Boolean).join(", ")}</p>
        </div>
        <span className="score" aria-label="Score">{g.score} / {g.total}</span>
      </div>

      <audio ref={audioRef} src={api.audioUrl(game.song_id)} preload="auto" onError={() => setAudioFailed(true)} onLoadedData={() => setAudioFailed(false)} />
      {audioFailed && <p className="notice error" role="alert">{en.audio.cannotLoad}</p>}
      <Runway
        runway={runway}
        focusedId={focusedQ?.id ?? null}
        onFocus={setManualFocus}
        gated={g.synced}
        onSeek={engine && duration > 0 ? (f) => void seekTo(f * duration) : undefined}
      />
      <p className="status" data-tone={status.tone} role="status">{status.text}</p>
      <LastAnswer quiz={g.quiz} results={g.results} questionId={lastAnswered} hint={hint} />
      {g.error && <p className="notice error">{g.error}</p>}

      {focusedQ ? (
        <Question
          key={focusedQ.id}
          question={focusedQ}
          siblings={siblings}
          results={g.results}
          index={focusedIndex}
          total={g.total}
          onAnswer={(oid) => answer(focusedQ, oid)}
        />
      ) : (
        <p className="notice">{en.game.notFound}</p>
      )}

      {g.finished && (
        <p className="notice ok finish">
          {en.game.finished(g.score, g.total)} · <a href={paths.library()}>{en.game.backToLibrary}</a>
        </p>
      )}
      <Sheet quiz={g.quiz} results={g.results} focusedId={focusedQ?.id ?? null} onFocus={focusFromSheet} />

      <Transport
        engineReady={!!engine}
        state={playback.state.name}
        time={time}
        duration={duration}
        onStart={start}
        onPlay={playback.play}
        onPause={playback.pause}
        onStop={stop}
        onBack={back5}
        onSeek={seekTo}
        volume={{ level: vol.volume, muted: vol.muted, set: vol.setVolume, toggleMute: vol.toggleMute, step: vol.step }}
      />
    </>
  );
}

/** The result of the answer just given, shown beside the already-visible next question (never in its way). */
function LastAnswer({ quiz, results, questionId, hint }: { quiz: readonly QuizQuestionT[]; results: ReadonlyMap<number, QuestionResult>; questionId: number | null; hint: string | null }) {
  const q = questionId === null ? undefined : quiz.find((x) => x.id === questionId);
  const shown = q ? resultWord(q, results.get(q.id)) : null;
  const text = !shown ? "" : shown.ok === undefined ? en.game.lastPending : shown.ok ? en.game.lastCorrect(shown.word) : en.game.lastWrong(shown.word);
  return (
    <p className="last-answer" data-ok={hint ? "false" : shown?.ok} role="status" aria-live="polite">
      {hint ?? text}
    </p>
  );
}
