import { useEffect, useMemo, useRef, useState } from "react";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { Marquee } from "./Marquee";
import { PlayButton } from "./PlayButton";
import { QueueDialog } from "./QueueDialog";
import { useAsync } from "../hooks/useAsync";
import { useExitTransition } from "../hooks/useExitTransition";
import { useQueue } from "../hooks/useQueue";
import { useSwipe } from "../hooks/useSwipe";
import { useQueueActions } from "../hooks/useQueueActions";
import { en } from "../i18n/en";
import * as Q from "../lib/queue";
import { api } from "../services/api";

/**
 * The play queue's bar (guide section 20): what comes next and the icon buttons that run it, fixed at the bottom of the screen.
 * Phones: a tap on the bar opens the queue, a swipe left skips to the next song and a swipe right goes back one; only Play stays as a button.
 */
export function QueueBar({ phone }: { phone: boolean }) {
  const store = useQueue();
  const actions = useQueueActions();
  const q = store.queue;
  const active = q.items.length > 0;
  const bar = useExitTransition(active, 220);
  const el = useRef<HTMLDivElement>(null);
  useSwipe(el, { directions: ["left", "right"], onSwipe: (dir) => (dir === "left" ? store.advance() : store.back()), enabled: phone && bar.mounted && !Q.finished(q) }); // `mounted`: the bar's element only exists while the queue is in use
  const songs = useAsync(() => (active ? api.songs() : Promise.resolve([])), [active]);
  const [listOpen, setListOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map((songs.data ?? []).map((s) => [s.id, s])), [songs.data]);
  const next = Q.next(q);
  const nextSong = next ? byId.get(next.songId) : undefined;
  const done = Q.finished(q);
  useEffect(() => { if (next && songs.data && !nextSong) songs.reload(); }, [next?.songId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const close = () => setListOpen(false); window.addEventListener("hashchange", close); return () => window.removeEventListener("hashchange", close); }, []);
  useEffect(() => { setError(null); }, [q.cursor]);
  useEffect(() => { if (!active) setListOpen(false); }, [active]);

  const play = async () => {
    setBusy(true);
    setError(null);
    setError(await actions.playNext());
    setBusy(false);
  };

  if (!bar.mounted) return null;
  const face = (
    <>
      {nextSong ? <Cover songId={nextSong.id} title={nextSong.title} hasCover={nextSong.has_cover} size="row" /> : <span className="cover-ph" aria-hidden="true" />}
      <span className="queue-bar-text">
        <strong><Marquee>{done ? en.queue.finishedTitle : nextSong ? en.queue.nextUp(nextSong.title) : "…"}</Marquee></strong>
        <small><Marquee>{store.message ?? (done ? en.queue.finishedSub(q.items.length) : `${en.queue.position(q.cursor + 1, q.items.length)}${nextSong ? ` · ${nextSong.artist}` : ""}`)}</Marquee></small>
        {error && <small className="queue-error" role="alert">{error}</small>}
      </span>
    </>
  );
  return (
    <>
      <div className="queue-bar" ref={el} data-state={bar.state} data-done={done} role="region" aria-label={en.queue.bar}>
        {phone && <div className="swipe-reveal prev" aria-hidden="true"><Icon name="skipNext" />{en.queue.swipeBack}</div>}
        {phone && <div className="swipe-reveal skip" aria-hidden="true">{en.queue.swipeSkip}<Icon name="skipNext" /></div>}
        <div className="queue-bar-row" data-swipe-face onClick={phone ? (e) => { if (!(e.target as HTMLElement).closest("button")) setListOpen(true); } : undefined}>
        {phone ? (
          <button type="button" className="queue-bar-face" aria-label={en.queue.openList} onClick={() => setListOpen(true)}>{face}</button>
        ) : (
          <div className="queue-bar-face">{face}</div>
        )}
        <div className="queue-bar-actions">
          {!phone && <button type="button" className="ib" aria-label={en.queue.openList} title={en.queue.openList} onClick={() => setListOpen(true)}><Icon name="queue" /></button>}
          {done ? (
            <PlayButton icon="shuffle" aria-label={en.queue.again} title={en.queue.again} onClick={() => store.start(q.items.map((i) => i.songId), { difficulty: q.items[0]!.difficulty, mode: q.items[0]!.mode }, true)} />
          ) : (
            <>
              <PlayButton aria-label={en.queue.playNext} title={en.queue.playNext} onClick={() => void play()} disabled={busy} />
              {!phone && <button type="button" className="ib" aria-label={en.queue.skip} title={en.queue.skip} onClick={store.advance}><Icon name="skipNext" /></button>}
            </>
          )}
          {(!phone || done) && <button type="button" className="ib" aria-label={done ? en.queue.close : en.queue.stop} title={done ? en.queue.close : en.queue.stop} onClick={store.clear}><Icon name={done ? "close" : "stop"} /></button>}
        </div>
        </div>
      </div>
      {listOpen && <QueueDialog phone={phone} onClose={() => setListOpen(false)} />}
    </>
  );
}
