import { useEffect, useMemo, useState } from "react";
import { Cover } from "./Cover";
import { Icon } from "./Icon";
import { QueueDialog } from "./QueueDialog";
import { useAsync } from "../hooks/useAsync";
import { useExitTransition } from "../hooks/useExitTransition";
import { useQueue } from "../hooks/useQueue";
import { useQueueActions } from "../hooks/useQueueActions";
import { en } from "../i18n/en";
import * as Q from "../lib/queue";
import { api } from "../services/api";

/** The play queue's bar (guide section 20): what comes next and the icon buttons that run it. Docked under the top bar; on touch screens above the bottom edge. */
export function QueueBar({ phone }: { phone: boolean }) {
  const store = useQueue();
  const actions = useQueueActions();
  const q = store.queue;
  const active = q.items.length > 0;
  const bar = useExitTransition(active, 220);
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
  return (
    <>
      <div className="queue-bar" data-state={bar.state} data-done={done} role="region" aria-label={en.queue.bar}>
        {nextSong ? <Cover songId={nextSong.id} title={nextSong.title} hasCover={nextSong.has_cover} size="row" /> : <span className="cover-ph" aria-hidden="true" />}
        <div className="queue-bar-text">
          <strong>{done ? en.queue.finishedTitle : nextSong ? en.queue.nextUp(nextSong.title) : "…"}</strong>
          <small>{store.message ?? (done ? en.queue.finishedSub(q.items.length) : `${en.queue.position(q.cursor + 1, q.items.length)}${nextSong ? ` · ${nextSong.artist}` : ""}`)}</small>
          {error && <small className="queue-error" role="alert">{error}</small>}
        </div>
        <div className="queue-bar-actions">
          <button type="button" className="ib" aria-label={en.queue.openList} title={en.queue.openList} onClick={() => setListOpen(true)}><Icon name="queue" /></button>
          {done ? (
            <button type="button" className="ib primary" aria-label={en.queue.again} title={en.queue.again} onClick={() => store.start(q.items.map((i) => i.songId), { difficulty: q.items[0]!.difficulty, mode: q.items[0]!.mode }, true)}><Icon name="shuffle" /></button>
          ) : (
            <>
              <button type="button" className="ib primary" aria-label={en.queue.playNext} title={en.queue.playNext} onClick={() => void play()} disabled={busy}><Icon name="play" /></button>
              <button type="button" className="ib" aria-label={en.queue.skip} title={en.queue.skip} onClick={store.advance}><Icon name="skipNext" /></button>
            </>
          )}
          <button type="button" className="ib" aria-label={done ? en.queue.close : en.queue.stop} title={done ? en.queue.close : en.queue.stop} onClick={store.clear}><Icon name={done ? "close" : "stop"} /></button>
        </div>
      </div>
      {listOpen && <QueueDialog phone={phone} onClose={() => setListOpen(false)} />}
    </>
  );
}
