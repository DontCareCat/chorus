import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useAsync } from "../hooks/useAsync";
import { useQueue } from "../hooks/useQueue";
import { en } from "../i18n/en";
import * as Q from "../lib/queue";
import { paths } from "../router";
import { api } from "../services/api";
import type { Standing } from "../hooks/useGame";

/** Seconds between the end of the music and the next song starting by itself. */
export const AUTOPLAY_SECONDS = 5;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Props {
  standing: Standing;
  correct: number;
  total: number;
  rank: number | null;
  /** this game was started by the play queue (only then is there a Next) */
  fromQueue: boolean;
  /** the music is audible */
  running: boolean;
  /** the music has played to its end */
  over: boolean;
  /** seconds of music left */
  remaining: number;
  settings: { autoplay: boolean; fade: boolean; fadeSeconds: number };
  /** start the next song; `fadeMs` > 0 = fade between the songs. Resolves to an error text, or null. */
  onNext: (fadeMs: number) => Promise<string | null>;
}

/**
 * The result of a finished game with its two ways on (design guide section 23): Library always, Next when the queue has another song.
 * With Autoplay the next song starts by itself: five seconds after the music ends, or, with the fade on, as many seconds before the end
 * as the fade is long. "Stay here" cancels that; Next still works.
 */
export function FinishCard({ standing, correct, total, rank, fromQueue, running, over, remaining, settings, onNext }: Props) {
  const { queue } = useQueue();
  const songs = useAsync(() => (fromQueue ? api.songs() : Promise.resolve([])), [fromQueue]);
  const next = fromQueue ? Q.next(queue) : null;
  const nextSong = songs.data?.find((s) => s.id === next?.songId);
  const [phase, setPhase] = useState<"idle" | "going" | "stay">("idle");
  const [left, setLeft] = useState(AUTOPLAY_SECONDS);
  const [error, setError] = useState<string | null>(null);

  const go = useRef((_manual: boolean) => {});
  go.current = (manual: boolean) => {
    if (phase === "going") return;
    setPhase("going");
    setError(null);
    const fadeMs = settings.fade && running ? Math.round(Math.min(settings.fadeSeconds * 1000, Math.max(300, remaining * 1000))) : 0;
    void onNext(fadeMs).then((e) => { if (e) { setError(e); setPhase(manual ? "idle" : "stay"); } });
  };

  const autoplaying = next !== null && settings.autoplay && phase === "idle" && !error;
  const fadeNow = autoplaying && settings.fade && running && remaining <= settings.fadeSeconds + 0.25;
  const counting = autoplaying && !fadeNow && over && !running;
  useEffect(() => { if (fadeNow) go.current(false); }, [fadeNow]);
  useEffect(() => {
    if (!counting) { setLeft(AUTOPLAY_SECONDS); return; }
    if (left <= 0) { go.current(false); return; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [counting, left]);

  const caption = (() => {
    if (!fromQueue) return null;
    if (next === null) return en.game.lastInQueue;
    if (error) return error;
    if (phase === "going") return "…";
    if (counting) return en.queue.startingIn(left);
    if (autoplaying && running) return settings.fade ? en.game.fadesInto(mmss(Math.max(0, remaining - settings.fadeSeconds))) : en.game.startsWhenEnds;
    return null;
  })();

  return (
    <section className="notice ok finish finish-card" aria-label={en.game.finishedTitle}>
      <span className="sr-only">{en.game.finished(standing.points, correct, total, standing.best)}</span>
      <div className="finish-top"><span className="finish-ok"><Icon name="check" /></span><h2>{en.game.finishedTitle}</h2></div>
      <div className="finish-nums" aria-hidden="true">
        <b>{standing.points}</b><span>{en.game.points.toLowerCase()}</span><span>{en.game.rightOf(correct, total)}</span><span>{en.game.bestMultiplier(standing.best)}</span>
      </div>
      {rank !== null && <p className="finish-rank">{en.scores.yourRank(rank)}</p>}
      <div className="finish-acts">
        <a className="btn secondary large" href={paths.library()}>{en.game.backToLibrary}</a>
        {next !== null && (
          <button type="button" className="btn large finish-next" data-counting={counting} onClick={() => go.current(true)} disabled={phase === "going"}>
            <Icon name="playArrow" />{en.game.next}
            {counting && <i className="finish-bar" key={String(counting)} />}
          </button>
        )}
      </div>
      {(caption || next) && (
        <p className="finish-cap" role="status">
          {next && <b>{nextSong?.title ?? "…"}</b>}
          {next && <span> · {en.queue.position(queue.cursor + 1, queue.items.length)}</span>}
          {caption && <span>{next ? " · " : ""}{caption}</span>}
          {counting && <button type="button" className="finish-stay" onClick={() => setPhase("stay")}>{en.queue.stayHere}</button>}
        </p>
      )}
    </section>
  );
}
