import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { LyricWindow } from "../components/LyricWindow";
import { Question } from "../components/Question";
import { Runway } from "../components/Runway";
import { ScorePanel } from "../components/ScorePanel";
import { Transport } from "../components/Transport";
import { buildWindowLines, currentLineIndex, timecode } from "../game/lyric-window";
import { resultWord } from "../game/results";
import type { QuestionResult } from "../game/results";
import { computeRunway } from "../game/runway";
import { describeStatus } from "../game/status";
import { useAsync } from "../hooks/useAsync";
import { useGame } from "../hooks/useGame";
import { useLayout } from "../hooks/useLayout";
import { useVolume } from "../hooks/useVolume";
import { usePlaybackSync } from "../hooks/usePlaybackSync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api } from "../services/api";
import { createEngine, getEngineKind } from "../services/audio/create-engine";
import type { GameEngine, PlaybackEngine } from "../services/audio/engine";
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
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [wantPlay, setWantPlay] = useState(false);
  const [manualFocus, setManualFocus] = useState<number | null>(null);
  const [, setFrame] = useState(0);
  const [lastAnswered, setLastAnswered] = useState<number | null>(null);
  // Seconds the game has waited for an answer since the last one (the multiplier loses a level per 5 s of it).
  const waited = useRef(0);
  const clock = useRef(performance.now());
  const lastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const vol = useVolume(engine as PlaybackEngine | null);
  const playback = usePlaybackSync({ engine: engine as PlaybackEngine | null, questions: g.syncQs, answered: g.answeredSet, gating: g.synced });
  const stateName = useRef(playback.state.name);
  stateName.current = playback.state.name;

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
    const t = setInterval(() => {
      const now = performance.now();
      if (stateName.current === "PAUSED_FOR_QUESTION") waited.current += Math.min((now - clock.current) / 1000, 0.5);
      clock.current = now;
      setFrame((n) => n + 1);
    }, 100);
    return () => clearInterval(t);
  }, []);
  useEffect(() => () => { clearTimeout(lastTimer.current); clearTimeout(hintTimer.current); }, []);
  useEffect(
    () => () => {
      engine?.dispose();
    },
    [engine],
  );

  // When the game is finished, say where it ranks on this song.
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    if (!g.finished) return;
    const t = setTimeout(() => {
      api.songScores(game.song_id).then((rows) => setRank(rows.find((r) => r.me)?.rank ?? null), () => undefined);
    }, 400); // the server has the last answer by then
    return () => clearTimeout(t);
  }, [g.finished, game.song_id]);

  const firstOpen = useMemo(() => g.quiz.find((q) => !g.answeredSet.has(q.id)) ?? null, [g.quiz, g.answeredSet]);
  const focusedQ = g.quiz.find((q) => q.id === manualFocus) ?? firstOpen ?? g.quiz[g.quiz.length - 1] ?? null;
  const focusedIndex = focusedQ ? g.quiz.indexOf(focusedQ) : -1;
  const siblings = useMemo(() => (focusedQ ? g.quiz.filter((x) => x.lineId === focusedQ.lineId) : []), [g.quiz, focusedQ]);

  const time = engine?.getCurrentTime() ?? 0;
  // Until the audio element knows its length, the API's duration keeps the runway meaningful.
  const engineDuration = engine?.getDuration() ?? NaN;
  const duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : game.song_duration;
  const runway = computeRunway({ duration, currentTime: time, questions: g.syncQs, answered: g.answeredSet });
  const windowLines = useMemo(
    () => buildWindowLines(game.lines, g.quiz, g.results, game.lyrics_offset, focusedQ?.id ?? null),
    [game.lines, game.lyrics_offset, g.quiz, g.results, focusedQ?.id],
  );
  const focusedLine = focusedQ ? windowLines.findIndex((l) => l.lineId === focusedQ.lineId) : -1;
  const currentLine = currentLineIndex(windowLines, time, g.synced, focusedLine);
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
      // The server scores the answer: "ahead" from where the audio is, the multiplier from how long the game waited.
      g.answer(q.id, optionId, { position: engine?.getCurrentTime() ?? 0, waited: waited.current }, () => playback.markAnswered(q.id));
      waited.current = 0;
      // The next open question (after this one, else the first open one) appears at once; the result of this
      // answer shows in a line of its own and in the lyric sheet. With nothing left, this question stays up.
      const after = g.quiz.slice(g.quiz.indexOf(q) + 1).find((x) => !g.answeredSet.has(x.id) && x.id !== q.id);
      const next = after ?? g.quiz.find((x) => !g.answeredSet.has(x.id) && x.id !== q.id) ?? null;
      setManualFocus(next ? next.id : q.id);
      setLastAnswered(q.id);
      clearTimeout(lastTimer.current);
      lastTimer.current = setTimeout(() => setLastAnswered(null), LAST_ANSWER_MS);
    },
    [g, playback, engine],
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
    setEngine(createEngine(audioRef.current, getEngineKind(), game.sample_rate));
    setWantPlay(true);
  };
  const stop = () => playback.stop();
  const back5 = () => playback.rewind(5);
  useEffect(() => {
    if (engine) (window as unknown as { __chorus: unknown }).__chorus = { engine, controller: playback.controller };
  }, [engine, playback.controller]);

  // the answer handler never changes identity, so the (memoised) question and lyric window are not redrawn ten times a second
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const focusedRef = useRef(focusedQ);
  focusedRef.current = focusedQ;
  const onAnswer = useCallback((optionId: number) => { if (focusedRef.current) answerRef.current(focusedRef.current, optionId); }, []);

  const layout = useLayout();
  const phone = layout === "phone";
  // Phone: the lyric window follows the audio. Answering ahead puts the question's line far from it: a chip says so
  // and, when tapped, holds the window on that line until the audio gets there or the question changes.
  const [pinned, setPinned] = useState(false);
  useEffect(() => setPinned(false), [focusedQ?.id]);
  useEffect(() => {
    if (pinned && focusedLine >= 0 && currentLine >= focusedLine) setPinned(false);
  }, [pinned, currentLine, focusedLine]);
  const centerOn = phone && pinned && focusedLine >= 0 ? focusedLine : currentLine;
  const farFromFocus = phone && focusedLine >= 0 && Math.abs(focusedLine - currentLine) > 3;
  const chip = !phone ? null : pinned ? { text: en.game.backToAudio, dir: "" } : farFromFocus ? { text: en.game.yourQuestion(timecode(windowLines[focusedLine]?.startTime ?? null)), dir: focusedLine > currentLine ? "down" : "up" } : null;
  const last = lastAnswerText(g.quiz, g.results, lastAnswered);
  const stateText = phone ? (hint ?? last.text) || status.text : status.text;

  const questionBlock = focusedQ ? (
    <Question
      key={focusedQ.id}
      question={focusedQ}
      siblings={siblings}
      results={g.results}
      index={focusedIndex}
      total={g.total}
      onAnswer={onAnswer}
      answersOnly={phone}
    />
  ) : (
    <p className="notice">{en.game.notFound}</p>
  );
  const finished = g.finished && (
    <p className="notice ok finish">
      {en.game.finished(g.standing.points, g.correct, g.total, g.standing.best)}{rank !== null && ` ${en.scores.yourRank(rank)}`} · <a href={paths.library()}>{en.game.backToLibrary}</a>
    </p>
  );
  const lyricWindow = (
    <div className="game-side">
      <LyricWindow lines={windowLines} current={centerOn} synced={g.synced} onFocus={focusFromSheet} />
      {chip && (
        <button type="button" className="chip-float" data-dir={chip.dir} onClick={() => setPinned((v) => !v)}>
          {chip.text}
          {chip.dir && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={chip.dir === "down" ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} /></svg>}
        </button>
      )}
    </div>
  );

  return (
    <div className="game" data-layout={layout}>
      <div className="game-bar wrap">
        <a className="back" href={paths.library()} aria-label={en.game.backToLibrary} title={en.game.backToLibrary}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        {!phone && <Cover songId={game.song_id} title={game.song_title} hasCover={null} size="large" />}
        <div className="game-title">
          <h1>{game.song_title}</h1>
          <p className="muted">{[game.song_artist, en.library.difficulty[game.difficulty] ?? game.difficulty, game.language].filter(Boolean).join(" · ")}</p>
        </div>
        <ScorePanel standing={g.standing} waited={waited.current} waiting={playback.state.name === "PAUSED_FOR_QUESTION"} gain={g.gain} />
      </div>

      <audio ref={audioRef} src={api.audioUrl(game.song_id)} preload="auto" onError={() => setAudioFailed(true)} onLoadedData={() => setAudioFailed(false)} />
      {audioFailed && <p className="notice error wrap" role="alert">{en.audio.cannotLoad}</p>}
      <div className="game-timeline wrap">
        <Runway
          runway={runway}
          focusedId={focusedQ?.id ?? null}
          onFocus={setManualFocus}
          gated={g.synced}
          onSeek={engine && duration > 0 ? (f) => void seekTo(f * duration) : undefined}
        />
        <p className="state-line" data-tone={status.tone} data-ok={phone && !hint ? last.ok : undefined} role="status">{stateText}</p>
      </div>
      <div className="game-body wrap">
        {phone ? (
          <>
            {lyricWindow}
            <div className="game-main">
              {g.error && <p className="notice error">{g.error}</p>}
              {finished}
              {questionBlock}
            </div>
          </>
        ) : (
          <>
            <div className="game-main">
              <LastAnswer text={hint ?? last.text} ok={hint ? false : last.ok} />
              {g.error && <p className="notice error">{g.error}</p>}
              {questionBlock}
              {finished}
            </div>
            {lyricWindow}
          </>
        )}
      </div>

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
    </div>
  );
}

/** What the last answer earned, as words ("Correct: Haus"), for the line under the timeline. */
function lastAnswerText(quiz: readonly QuizQuestionT[], results: ReadonlyMap<number, QuestionResult>, questionId: number | null): { text: string; ok: boolean | undefined } {
  const q = questionId === null ? undefined : quiz.find((x) => x.id === questionId);
  const shown = q ? resultWord(q, results.get(q.id)) : null;
  if (!shown) return { text: "", ok: undefined };
  return { text: shown.ok === undefined ? en.game.lastPending : shown.ok ? en.game.lastCorrect(shown.word) : en.game.lastWrong(shown.word), ok: shown.ok };
}

/** The result of the answer just given, shown beside the already-visible next question (never in its way). */
function LastAnswer({ text, ok }: { text: string; ok: boolean | undefined }) {
  return (
    <p className="last-answer" data-ok={ok} role="status" aria-live="polite">
      {text}
    </p>
  );
}
