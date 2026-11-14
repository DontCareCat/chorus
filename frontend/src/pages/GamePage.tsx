import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marquee } from "../components/Marquee";
import { Vinyl } from "../components/Vinyl";
import { LyricWindow } from "../components/LyricWindow";
import type { WordHit } from "../components/LyricWindow";
import { WordCard } from "../components/WordCard";
import { Question } from "../components/Question";
import { ScorePanel } from "../components/ScorePanel";
import { QueueDialog } from "../components/QueueDialog";
import { FinishCard } from "../components/FinishCard";
import { Transport } from "../components/Transport";
import { useQueue } from "../hooks/useQueue";
import { useQueueActions } from "../hooks/useQueueActions";
import { clearArrival, fadeOutAndRelease, peekArrival } from "../lib/handoff";
import * as Q from "../lib/queue";
import { buildWindowLines, currentLineIndex, focusLine, reuseLines } from "../game/lyric-window";
import type { WindowLine } from "../game/lyric-window";
import { resultWord } from "../game/results";
import type { QuestionResult } from "../game/results";
import { describeError } from "../game/status";
import { buildStripLines, scrubLimit } from "../game/strip";
import { loadPeaks } from "../lib/peaks";
import type { Peaks } from "../game/strip";
import type { StripHandle } from "../components/ProgressStrip";
import { useAsync } from "../hooks/useAsync";
import { useGame } from "../hooks/useGame";
import { useLyricFocus } from "../hooks/useLyricFocus";
import { useGameArrangement, useLayout } from "../hooks/useLayout";
import { useVolume } from "../hooks/useVolume";
import { usePlaybackSync } from "../hooks/usePlaybackSync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api } from "../services/api";
import type { Answer } from "../services/api";
import { Toast, useToast } from "../components/Toast";
import { createEngine, getEngineKind } from "../services/audio/create-engine";
import { createYouTubeEngine } from "../services/audio/youtube-player";
import type { GameEngine, PlaybackEngine } from "../services/audio/engine";
import type { GameDto } from "../types/game";
import type { QuizQuestion as QuizQuestionT } from "../types/question";

const LAST_ANSWER_MS = 4000; // how long the result line of the previous answer stays visible

/** The song's loudness for the player's strip: decoded once, kept; a YouTube song has none (the strip then shows even lines). */
function usePeaks(songId: number, duration: number, youtube: boolean): Peaks | null {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    if (youtube) return;
    let gone = false;
    void loadPeaks(songId, api.audioUrl(songId), duration).then((p) => { if (!gone) setPeaks(p); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, youtube]);
  return peaks;
}

export function GamePage({ publicId }: { publicId: string }) {
  const game = useAsync(() => api.getGame(publicId), [publicId]);
  if (game.error) return <p className="notice error">{game.error.status === 404 ? en.game.notFound : game.error.message}</p>;
  if (!game.data) return <p className="muted">…</p>;
  return <GameScreen game={game.data} />;
}

function GameScreen({ game }: { game: GameDto }) {
  const g = useGame(game);
  const layout = useLayout();
  const { focus: lyricFocus } = useLyricFocus();
  const arrangement = useGameArrangement(true);
  // The <audio> element lives in <body>, outside React's tree: when a queue moves on with a fade between songs it keeps playing (and fading
  // out) after this page has gone, and a browser pauses an element that is removed from the page.
  const [audioEl] = useState(() => { const a = document.createElement("audio"); a.preload = "auto"; return a; });
  const handedOff = useRef(false);
  const arrival = useRef(peekArrival()); // how this game was reached: started by the queue, with a fade-in?
  const [engine, setEngine] = useState<GameEngine | null>(null);
  // A YouTube song is played by YouTube's own player, shown on the page (never covered), instead of the <audio> element.
  const youtubeId = game.youtube_id ?? null;
  const ytHost = useRef<HTMLDivElement>(null);
  const [ytEngine, setYtEngine] = useState<GameEngine | null>(null);
  const startWhenReady = useRef(false);
  const [wantPlay, setWantPlay] = useState(false);
  const queueStore = useQueue();
  const queueActions = useQueueActions();
  const settings = useAsync(() => api.settings(), []);
  const [queueOpen, setQueueOpen] = useState(false);
  // a tapped lyric word: the song is paused while its card is open, and goes on when the card closes (only if it was playing)
  const [wordHit, setWordHit] = useState<WordHit | null>(null);
  const resumeAfterWord = useRef(false);
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
  const [audioError, setAudioError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [hintToast, setHintToast] = useToast(3500);
  /** A short remark to the player: a floating toast on a phone, the answer line / keyboard line elsewhere. */
  const showHint = useCallback((text: string) => {
    setHint(text);
    setHintToast({ kind: "ok", text });
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 3500);
  }, [setHintToast]);
  const stripRef = useRef<StripHandle>(null);
  /** The strip let go on `t`: seek (never past an open question) and play again if it was playing. */
  const scrubEnd = useCallback(async (t: number, wasPlaying: boolean) => {
    const end = engine?.getDuration();
    const outcome = await playback.scrubEnd(Math.max(0, Number.isFinite(end) && end ? Math.min(t, end) : t), wasPlaying);
    if (outcome.clamped) showHint(en.game.cannotSkip);
    return outcome;
  }, [engine, playback.scrubEnd, showHint]);

  // Start playing once the engine exists AND its controller is ready (first click is the user gesture).
  useEffect(() => {
    if (wantPlay && playback.controller) {
      if (arrival.current?.fadeMs) playback.controller.playFadingIn(arrival.current.fadeMs); // a song that follows another fades in as long as the fade is set
      else playback.play();
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
      if (!handedOff.current) engine?.dispose();
    },
    [engine],
  );
  useEffect(() => {
    if (!youtubeId || !ytHost.current) return;
    let gone = false, made: GameEngine | null = null;
    createYouTubeEngine(ytHost.current, youtubeId).then(
      (e) => {
        if (gone) { e.dispose(); return; }
        made = e;
        e.onError((m) => { setAudioFailed(true); setAudioError(m); });
        setYtEngine(e);
        setAudioFailed(false);
        if (startWhenReady.current) { startWhenReady.current = false; setEngine(e); setWantPlay(true); }
      },
      (err: Error) => { if (!gone) { setAudioFailed(true); setAudioError(err.message); } },
    );
    return () => { gone = true; made?.dispose(); };
  }, [youtubeId]);
  useEffect(() => {
    if (youtubeId) return;
    audioEl.src = api.audioUrl(game.song_id);
    const failed = () => setAudioFailed(true), loaded = () => setAudioFailed(false);
    audioEl.addEventListener("error", failed);
    audioEl.addEventListener("loadeddata", loaded);
    document.body.appendChild(audioEl);
    return () => {
      audioEl.removeEventListener("error", failed);
      audioEl.removeEventListener("loadeddata", loaded);
      if (!handedOff.current) { audioEl.pause(); audioEl.removeAttribute("src"); audioEl.remove(); }
    };
  }, [audioEl, game.song_id, youtubeId]);

  // When the game is finished, say where it ranks on this song.
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    if (!g.finished) return;
    const t = setTimeout(() => {
      api.songScores(game.song_id, game.mode).then((rows) => setRank(rows.find((r) => r.me)?.rank ?? null), () => undefined);
    }, 400); // the server has the last answer by then
    return () => clearTimeout(t);
  }, [g.finished, game.song_id]);

  const firstOpen = useMemo(() => g.quiz.find((q) => !g.answeredSet.has(q.id)) ?? null, [g.quiz, g.answeredSet]);
  const focusedQ = g.quiz.find((q) => q.id === manualFocus) ?? firstOpen ?? g.quiz[g.quiz.length - 1] ?? null;
  const focusedIndex = focusedQ ? g.quiz.indexOf(focusedQ) : -1;
  const siblings = useMemo(() => (focusedQ ? g.quiz.filter((x) => x.lineId === focusedQ.lineId) : []), [g.quiz, focusedQ]);

  const time = engine?.getCurrentTime() ?? 0;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const getTime = useCallback(() => engineRef.current?.getCurrentTime() ?? 0, []);
  const onGate = useCallback(() => showHint(en.game.cannotSkip), [showHint]);
  // Until the audio element knows its length, the API's duration keeps the runway meaningful.
  const engineDuration = engine?.getDuration() ?? NaN;
  const duration = Number.isFinite(engineDuration) && engineDuration > 0 ? engineDuration : game.song_duration;
  const lengthSaved = useRef(false);
  useEffect(() => { // a YouTube song's length is known once the player tells it: keep it for the lyrics matching and the runway
    if (!youtubeId || lengthSaved.current || !(engineDuration > 0) || Math.round(engineDuration) === Math.round(game.song_duration)) return;
    lengthSaved.current = true;
    api.patchSong(game.song_id, { duration: Math.round(engineDuration) }).catch(() => { lengthSaved.current = false; });
  }, [youtubeId, game.song_duration, game.song_id, engineDuration]);
  // the same line objects as before for every line an answer did not touch, so the lyric window redraws only what changed
  const lastLines = useRef<WindowLine[] | null>(null);
  const windowLines = useMemo(() => {
    const next = reuseLines(lastLines.current, buildWindowLines(game.lines, g.quiz, g.results, game.lyrics_offset, focusedQ?.id ?? null));
    lastLines.current = next;
    return next;
  }, [game.lines, game.lyrics_offset, g.quiz, g.results, focusedQ?.id]);
  // the strip's question lines only change with the answers, not with the playhead
  const stripLines = useMemo(() => (g.synced ? buildStripLines(g.syncQs, g.answeredSet, g.results) : []), [g.synced, g.syncQs, g.answeredSet, g.results]);
  const limit = g.synced ? scrubLimit(g.syncQs, g.answeredSet, duration) : duration;
  const peaks = usePeaks(game.song_id, duration, !!youtubeId);
  // The lyrics follow the song. Answering AHEAD of it (a line it has not reached) moves them on to the next question, until the song catches up.
  const [ahead, setAhead] = useState(false);
  const aheadRef = useRef(ahead);
  aheadRef.current = ahead;
  const [pulse, setPulse] = useState(0); // every answer takes a reader who scrolled the lyrics away back to the followed line
  const focusedLine = focusedQ ? windowLines.findIndex((l) => l.lineId === focusedQ.lineId) : -1;
  const currentLine = currentLineIndex(windowLines, time, g.synced, focusedLine);
  useEffect(() => { if (aheadRef.current && focusedLine <= currentLine) setAhead(false); }, [focusedLine, currentLine]); // caught up (only when set: see the note on nested updates)

  /** Choosing a line from the lyric sheet (far below the question) also brings its question into view. */
  const focusFromSheet = useCallback((id: number) => {
    setManualFocus(id);
    setAhead(false); // the reader chose this line: the window stays where it is
    requestAnimationFrame(() =>
      document.querySelector(".prompt-wrap")?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      }),
    );
  }, []);

  const answer = useCallback(
    (q: (typeof g.quiz)[number], given: Answer) => {
      // The server scores the answer: "ahead" from where the audio is, the multiplier from how long the game waited.
      g.answer(q.id, given, { position: playback.controller?.positionForAnswer() ?? engine?.getCurrentTime() ?? null, waited: waited.current }, () => playback.markAnswered(q.id));
      waited.current = 0;
      // The next open question (after this one, else the first open one) appears at once; the result of this
      // answer shows in a line of its own and in the lyric sheet. With nothing left, this question stays up.
      const after = g.quiz.slice(g.quiz.indexOf(q) + 1).find((x) => !g.answeredSet.has(x.id) && x.id !== q.id);
      const next = after ?? g.quiz.find((x) => !g.answeredSet.has(x.id) && x.id !== q.id) ?? null;
      setManualFocus(next ? next.id : q.id);
      setAhead(windowLines.findIndex((l) => l.lineId === q.lineId) > currentLine); // answered a line the song has not reached: the lyrics move on to the next question
      setPulse((n) => n + 1);
      setLastAnswered(q.id);
      clearTimeout(lastTimer.current);
      lastTimer.current = setTimeout(() => setLastAnswered(null), LAST_ANSWER_MS);
    },
    [g, playback, engine, windowLines, currentLine],
  );

  // Keyboard: 1–4 answer, Space plays/pauses, arrows seek, ↑/↓ volume, M mutes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (e.key === " ") {
        e.preventDefault(); // no page scroll, and a focused button is not also "clicked" by the same key
        if (!e.repeat) togglePlayRef.current();
        return;
      }
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && engine) {
        e.preventDefault();
        stripRef.current?.nudge(e.key === "ArrowRight" ? 5 : -5); // the same fade-out / fade-in as a drag
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
      if (game.mode === "choice" && focusedQ && o && !g.answeredSet.has(focusedQ.id)) answer(focusedQ, { optionId: o.id });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedQ, g.answeredSet, answer, engine, vol.step, vol.toggleMute, game.mode]);

  const start = () => {
    if (engine || started.current) return;
    started.current = true;
    if (youtubeId) {
      if (ytEngine) { setEngine(ytEngine); setWantPlay(true); } else startWhenReady.current = true; // the player is still loading
      return;
    }
    setEngine(createEngine(audioEl, getEngineKind(), game.sample_rate));
    setWantPlay(true);
  };
  const started = useRef(false);
  // a game the queue moved on to starts by itself (it was reached from a click, so the browser lets it play)
  useEffect(() => {
    if (arrival.current?.autostart) startRef.current();
    clearArrival();
  }, []);
  // Dialogs and sheets stop at the player's edge (styles.css reads these), and the video is paused once when one opens.
  useEffect(() => {
    if (!youtubeId) return;
    const root = document.documentElement;
    const host = ytHost.current;
    const set = () => {
      const r = host?.getBoundingClientRect();
      if (!r) return;
      root.style.setProperty("--yt-bottom", `${Math.round(r.bottom)}px`);
      root.style.setProperty("--yt-right", `${Math.round(r.right)}px`);
    };
    root.classList.add("yt-game");
    set();
    const ro = host && typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    if (host) ro?.observe(host);
    let overlay = false;
    const mo = new MutationObserver(() => {
      const now = !!document.querySelector(".sheet-scrim, .dialog-scrim");
      if (now) set(); // the player may have moved since it was last measured (the keyboard went, the bar came back)
      if (now && !overlay && (stateName.current === "PLAYING" || stateName.current === "FADING_IN")) playback.pause();
      overlay = now;
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const poll = window.setInterval(set, 700);
    window.addEventListener("resize", set);
    return () => { ro?.disconnect(); mo.disconnect(); window.clearInterval(poll); window.removeEventListener("resize", set); root.classList.remove("yt-game", "yt-cols"); root.style.removeProperty("--yt-bottom"); root.style.removeProperty("--yt-right"); };
  }, [youtubeId, arrangement.columns, playback]);
  useEffect(() => { document.documentElement.classList.toggle("yt-cols", !!youtubeId && arrangement.columns); }, [youtubeId, arrangement.columns]);
  // typing needs the keyboard, and with less than 216 px visible the player cannot keep its 200 px: the video waits until the screen is turned
  const tooShortToType = !!youtubeId && game.mode === "typing" && arrangement.keyboard && arrangement.visibleHeight < 216;
  useEffect(() => {
    if (!tooShortToType) return;
    if (stateName.current === "PLAYING" || stateName.current === "FADING_IN") playback.pause();
    setHint(en.game.rotateToType);
    const t = setTimeout(() => setHint(null), 3500);
    return () => clearTimeout(t);
  }, [tooShortToType, playback]);

  // YouTube's own controls stay on the player: what is done there is passed to the game, which keeps its say over the audio.
  useEffect(() => {
    if (!youtubeId || !ytEngine) return;
    return ytEngine.onStateChange((s) => {
      const n = stateName.current;
      if (s === "playing") {
        if (!engine) startRef.current(); // the video was started on the player itself: that is Start
        else if (n === "PAUSED_FOR_QUESTION" || n === "IDLE") ytEngine.pause(); // an open question cannot be played past
        else if (n === "PAUSED") playback.play();
      } else if (s === "paused" && (n === "PLAYING" || n === "FADING_IN")) playback.pause();
    });
  }, [youtubeId, ytEngine, engine, playback]);
  const startRef = useRef(start);
  startRef.current = start;
  // Space: pause while the song runs (also during a fade), otherwise play; the first press starts the engine.
  const togglePlayRef = useRef(() => {});
  togglePlayRef.current = () => {
    if (!engine) return start();
    const n = playback.state.name;
    if (n === "PLAYING" || n === "FADING_IN" || n === "FADING_OUT") playback.pause();
    else if (n !== "SEEKING") playback.play();
  };
  const openWord = useCallback((hit: WordHit) => {
    const n = stateName.current;
    if (!wordOpen.current) resumeAfterWord.current = n === "PLAYING" || n === "FADING_IN"; // a second tap keeps the first decision
    if (n === "PLAYING" || n === "FADING_IN") playbackRef.current.pause();
    wordOpen.current = true;
    setWordHit(hit);
  }, []);
  const closeWord = useCallback(() => {
    wordOpen.current = false;
    setWordHit(null);
    if (resumeAfterWord.current) { resumeAfterWord.current = false; playbackRef.current.play(); }
  }, []);
  const wordOpen = useRef(false);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  useEffect(() => {
    if (engine) (window as unknown as { __chorus: unknown }).__chorus = { engine, controller: playback.controller };
  }, [engine, playback.controller]);

  // the answer handler never changes identity, so the (memoised) question and lyric window are not redrawn ten times a second
  const answerRef = useRef(answer);
  answerRef.current = answer;
  const focusedRef = useRef(focusedQ);
  focusedRef.current = focusedQ;
  const onAnswer = useCallback((optionId: number) => { if (focusedRef.current) answerRef.current(focusedRef.current, { optionId }); }, []);
  const onSubmit = useCallback((text: string) => { if (focusedRef.current) answerRef.current(focusedRef.current, { text }); }, []);

  const phone = layout === "phone";
  // the record turns while the music is audible
  const spinning = playback.state.name === "PLAYING" || playback.state.name === "FADING_IN" || playback.state.name === "FADING_OUT";
  const asked = focusedQ && !g.answeredSet.has(focusedQ.id) ? focusedLine : -1; // nothing left to answer: no question line
  const centerOn = focusLine(lyricFocus, currentLine, focusedLine, asked >= 0, ahead); // nothing left to answer: the song's line again
  const last = lastAnswerText(g.quiz, g.results, lastAnswered);
  // no running commentary on the audio ("closes in 4 s"): the line only carries the phone's answer feedback and real audio errors
  const stateText = playback.state.name === "ERROR" ? describeError(playback.state.error) : "";

  const [errorSeen, setErrorSeen] = useState("");
  const errorToast = phone && stateText && errorSeen !== stateText ? { kind: "error" as const, text: stateText } : null; // a playback error stays until dismissed
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
      typing={game.mode === "typing"}
      onSubmit={onSubmit}
    />
  ) : (
    <p className="notice">{en.game.notFound}</p>
  );
  // a game the queue started offers Next, and (Autoplay) carries on by itself; see FinishCard
  const hasNextInQueue = Q.upcoming(queueStore.queue).length > 0;
  const musicOver = !spinning && (!engine || (duration > 0 && time >= duration - 0.6)); // never started counts as over: a reloaded finished game carries on
  const queueSettings = settings.data
    ? { autoplay: settings.data.queue_autoplay, fade: settings.data.queue_fade, fadeSeconds: settings.data.queue_fade_seconds }
    : { autoplay: false, fade: false, fadeSeconds: 4 }; // until the settings are known nothing starts by itself
  const goNext = useCallback((fadeMs: number) => queueActions.playNext({
    arrival: { fadeMs, autostart: true },
    beforeNavigate: () => {
      const ghostMs = fadeMs || (spinning ? 400 : 0); // the old song never just stops: it fades out while this page is replaced
      if (youtubeId && engine) { playback.release(); return engine.fadeOut(Math.max(ghostMs, 400)).then(() => undefined); } // an embedded player cannot be handed on: it fades out here, the next song starts fresh
      if (ghostMs > 0 && engine) { handedOff.current = true; playback.release(); fadeOutAndRelease(engine, audioEl, ghostMs); }
    },
  }), [queueActions, spinning, engine, playback, audioEl, youtubeId]);
  /** Next song now, from the player: a swipe, the Next button or the queue sheet. The fade is the queue's, as long as one can be heard. */
  const skipToNext = useCallback(() => {
    const fadeMs = queueSettings.fade && spinning ? Math.round(Math.min(queueSettings.fadeSeconds * 1000, Math.max(300, Math.max(0, duration - time) * 1000))) : 0;
    void goNext(fadeMs).then((e) => { if (e) showHint(e); });
  }, [goNext, queueSettings.fade, queueSettings.fadeSeconds, spinning, duration, time]);
  const finished = g.finished && (
    <FinishCard
      standing={g.standing}
      correct={g.correct}
      total={g.total}
      rank={rank}
      fromQueue={queueStore.queue.playing === game.public_id}
      running={spinning}
      over={musicOver}
      remaining={Math.max(0, duration - time)}
      settings={queueSettings}
      onNext={goNext}
    />
  );
  const lyricWindow = (
    <div className="game-side">
      <LyricWindow lines={windowLines} current={centerOn} playing={g.synced ? currentLine : -1} asked={asked} synced={g.synced} onFocus={focusFromSheet} pulse={pulse} onWord={openWord} />
    </div>
  );

  const kbMode = !!youtubeId && arrangement.keyboard && game.mode === "typing" && arrangement.visibleHeight < 380;
  const stage = youtubeId ? <div className="yt-stage" data-testid="yt-stage"><div className="yt-player" ref={ytHost} /></div> : null;

  return (
    <div className="game" data-layout={layout} data-game={arrangement.columns ? "two" : "one"} data-short={arrangement.short || undefined} data-land={arrangement.land || undefined} data-kb={arrangement.keyboard || undefined} data-kbmode={kbMode || undefined} data-yt={youtubeId ? "" : undefined}>
      <div className="game-bar wrap">
        <a className="back" href={paths.library()} aria-label={en.game.backToLibrary} title={en.game.backToLibrary}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </a>
        {!phone && !youtubeId && <Vinyl songId={game.song_id} title={game.song_title} hasCover={null} spinning={spinning} />}
        <div className="game-title">
          <h1><Marquee>{game.song_title}</Marquee></h1>
          <p className="muted">{[game.song_artist, en.library.difficulty[game.difficulty] ?? game.difficulty, game.language.toUpperCase()].filter(Boolean).join(" · ")}</p>
        </div>
        <ScorePanel standing={g.standing} waited={waited.current} waiting={playback.state.name === "PAUSED_FOR_QUESTION"} gain={g.gain} />
      </div>

      {stage}
      <div className="game-timeline wrap">
        {audioFailed && <p className="notice error" role="alert">{youtubeId ? (audioError ?? en.game.cannotPlayHere) : (audioError ?? en.audio.cannotLoad)}{youtubeId && (hasNextInQueue ? <> <button type="button" className="link-btn" onClick={skipToNext}>{en.game.playNext}</button></> : <> <a href={paths.library()}>{en.game.backToLibrary}</a></>)}</p>}
        {stateText && !phone && <p className="notice error" role="alert">{stateText}</p>}
      </div>
      <div className="game-body wrap">
        {phone ? (
          <>
            {lyricWindow}
            <div className="game-main">
              {g.error && <p className="notice error">{g.error}</p>}
              {finished}
              {kbMode && focusedQ && <p className="kb-line" title={hint ?? focusedQ.questionText}>{hint ?? focusedQ.questionText}</p>}
              {questionBlock}
              {kbMode && <span className="kb-score" aria-hidden="true">{g.standing.points}</span>}
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
        getTime={getTime}
        duration={duration}
        onStart={start}
        onPlay={playback.play}
        onPause={playback.pause}
        phone={phone}
        lines={stripLines}
        peaks={peaks}
        limit={limit}
        onScrubStart={playback.scrubStart}
        onScrubEnd={scrubEnd}
        onGate={onGate}
        strip={stripRef}
        queue={{ count: Q.upcoming(queueStore.queue).length, onOpen: () => setQueueOpen(true) }}
        volume={{ level: vol.volume, muted: vol.muted, set: vol.setVolume, toggleMute: vol.toggleMute, step: vol.step }}
      />
      {phone && <div className="toast-lane"><Toast toast={errorToast ?? hintToast} onDismiss={errorToast ? () => setErrorSeen(stateText) : undefined} /></div>}
      {wordHit && <WordCard hit={wordHit} language={game.language} songId={game.song_id} onClose={closeWord} />}
      {queueOpen && <QueueDialog phone={phone} onClose={() => setQueueOpen(false)} onSkip={() => { setQueueOpen(false); skipToNext(); }} />}
    </div>
  );
}

/** What the last answer earned, as words ("Correct: Haus"), for the line under the timeline. */
function lastAnswerText(quiz: readonly QuizQuestionT[], results: ReadonlyMap<number, QuestionResult>, questionId: number | null): { text: string; ok: boolean | undefined } {
  const q = questionId === null ? undefined : quiz.find((x) => x.id === questionId);
  const shown = q ? resultWord(q, results.get(q.id)) : null;
  if (!shown) return { text: "", ok: undefined };
  const text = shown.ok === undefined ? en.game.lastPending : shown.match === "partial" ? en.game.lastAlmost(shown.word) : shown.ok ? en.game.lastCorrect(shown.word) : en.game.lastWrong(shown.word);
  return { text, ok: shown.match === "partial" ? undefined : shown.ok };
}

/** The result of the answer just given, shown beside the already-visible next question (never in its way). */
function LastAnswer({ text, ok }: { text: string; ok: boolean | undefined }) {
  return (
    <p className="last-answer" data-ok={ok} role="status" aria-live="polite">
      {text}
    </p>
  );
}
