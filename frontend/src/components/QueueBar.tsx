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
  useSwipe(el, { directions: q.cursor > 0 ? ["left", "right"] : ["left"], carousel: true, onSwipe: (dir) => (dir === "left" ? store.advance() : store.back()), enabled: phone && bar.mounted && !Q.finished(q) }); // `mounted`: the bar's element only exists while the queue is in use
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
  /** What the bar shows when the queue's cursor is at `c`: the song that comes next (or the end). */
  const face = (c: number, live: boolean) => {
    const item = q.items[c];
    const song = item ? byId.get(item.songId) : undefined;
    const over = c >= q.items.length;
    return (
      <>
        {song ? <Cover songId={song.id} title={song.title} hasCover={song.has_cover} youtubeId={song.youtube_id} size="row" /> : <span className="cover-ph" aria-hidden="true" />}
        <span className="queue-bar-text">
          <strong><Marquee>{over ? en.queue.finishedTitle : song ? en.queue.nextUp(song.title) : "…"}</Marquee></strong>
          <small><Marquee>{(live && store.message) || (over ? en.queue.finishedSub(q.items.length) : `${en.queue.position(c + 1, q.items.length)}${song ? ` · ${song.artist}` : ""}`)}</Marquee></small>
          {live && error && <small className="queue-error" role="alert">{error}</small>}
        </span>
      </>
    );
  };
  return (
    <>
      <div className="queue-bar" ref={el} data-state={bar.state} data-done={done} role="region" aria-label={en.queue.bar}>
        <div className="queue-bar-row" onClick={phone ? (e) => { if (!(e.target as HTMLElement).closest("button")) setListOpen(true); } : undefined}>
        {phone ? (
          // the songs before and after sit beside the one in view, so a swipe slides them in (the face is `data-swipe-face`: only it moves, not the Play button)
          <div className="queue-bar-view">
            <div className="queue-bar-strip" data-swipe-face>
              {q.cursor > 0 && <div className="qb-panel before" aria-hidden="true">{face(q.cursor - 1, false)}</div>}
              <button type="button" className="queue-bar-face qb-panel" aria-label={en.queue.openList} onClick={() => setListOpen(true)}>{face(q.cursor, true)}</button>
              {!done && <div className="qb-panel after" aria-hidden="true">{face(q.cursor + 1, false)}</div>}
            </div>
          </div>
        ) : (
          <div className="queue-bar-face">{face(q.cursor, true)}</div>
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
