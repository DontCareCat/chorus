import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useAsync } from "../hooks/useAsync";
import { useQueue } from "../hooks/useQueue";
import { useQueueActions } from "../hooks/useQueueActions";
import { en } from "../i18n/en";
import * as Q from "../lib/queue";
import { api } from "../services/api";

const SECONDS = 5;

/** After a queued game: "Next: title, starting in 5 s" with Play now and Stay here. Shown only while the music is not playing. */
export function QueueNext() {
  const { queue } = useQueue();
  const actions = useQueueActions();
  const songs = useAsync(() => api.songs(), []);
  const next = Q.next(queue);
  const [left, setLeft] = useState(SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"count" | "wait" | "going">("count");
  const title = songs.data?.find((s) => s.id === next?.songId)?.title ?? "…";
  const go = () => { setPhase("going"); void actions.playNext().then((e) => { setError(e); if (e) setPhase("wait"); }); };

  useEffect(() => {
    if (phase !== "count" || error) return;
    if (left <= 0) { go(); return; }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, phase, error]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!next) return null;
  return (
    <div className="queue-next" role="status">
      <div className="queue-next-text">
        <strong>{en.queue.nextUp(title)}</strong>
        <small>{error ?? (phase === "count" ? en.queue.startingIn(left) : phase === "going" ? "…" : en.queue.position(queue.cursor + 1, queue.items.length))}</small>
      </div>
      <button type="button" className="ib primary" onClick={go} disabled={phase === "going"} aria-label={en.queue.playNext} title={en.queue.playNext}><Icon name="play" /></button>
      {phase === "count" && <button type="button" className="ib" onClick={() => setPhase("wait")} aria-label={en.queue.stayHere} title={en.queue.stayHere}><Icon name="close" /></button>}
    </div>
  );
}
