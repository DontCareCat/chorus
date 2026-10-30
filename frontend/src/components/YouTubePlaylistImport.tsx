import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { IMPORT_BATCH } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import { loadPlaylistVideoIds } from "../services/audio/youtube-player";

type Step =
  | { step: "reading" }
  | { step: "error"; message: string }
  | { step: "found"; ids: string[] }
  | { step: "running"; ids: string[]; done: number }
  | { step: "done"; added: number; existing: number; failed: number; notTried: string[]; playlist: string | null };

/** Importing a public YouTube playlist: read its videos (YouTube's own player lists them, no key), add them a batch at a time, optionally into a Chorus playlist. */
export function YouTubePlaylistImport({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const [state, setState] = useState<Step>({ step: "reading" });
  const [name, setName] = useState<string>(en.library.plNameDefault);
  const [makeList, setMakeList] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const songIds = useRef<number[]>([]);

  useEffect(() => {
    let gone = false;
    songIds.current = [];
    setState({ step: "reading" });
    if (!host.current) return;
    loadPlaylistVideoIds(host.current, listId).then(
      (ids) => { if (!gone) setState({ step: "found", ids }); },
      (e: Error) => { if (!gone) setState({ step: "error", message: e.message }); },
    );
    return () => { gone = true; };
  }, [listId]);

  const run = async (ids: string[], done: { added: number; existing: number; failed: number }) => {
    let { added, existing, failed } = done;
    for (let at = 0; at < ids.length; at += IMPORT_BATCH) {
      setState({ step: "running", ids, done: at });
      const batch = ids.slice(at, at + IMPORT_BATCH);
      let r;
      try {
        r = await api.importYouTubeVideos(batch);
      } catch (e) {
        setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic });
        return;
      }
      added += r.added; existing += r.existing; failed += r.failed.length;
      songIds.current.push(...r.songs.map((s) => s.id));
      if (r.not_tried.length) {
        setState({ step: "done", added, existing, failed, notTried: [...r.not_tried, ...ids.slice(at + IMPORT_BATCH)], playlist: null });
        onAdded();
        return;
      }
    }
    let playlist: string | null = null;
    if (makeList && songIds.current.length) {
      const base = name.trim() || en.library.plNameDefault;
      for (let n = 1; n < 20 && playlist === null; n++) {
        const tryName = n === 1 ? base : `${base} (${n})`;
        try {
          const made = await api.createPlaylist(tryName);
          await api.addToPlaylist(made.id, songIds.current);
          playlist = tryName;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) break; // 409: the name is taken, try the next
        }
      }
    }
    setState({ step: "done", added, existing, failed, notTried: [], playlist });
    onAdded();
  };

  const s = state;
  return (
    <div className="yt-playlist">
      <div className="yt-reader" ref={host} hidden={s.step !== "reading"} />
      {s.step === "reading" && <p className="muted" role="status">{en.library.plReading}</p>}
      {s.step === "error" && <p className="yt-problem" role="alert">{s.message}</p>}
      {s.step === "found" && (
        <div className="yt-found">
          <p><strong>{en.library.plFound(s.ids.length)}</strong>{s.ids.length >= 200 && <small> {en.library.plLimit}</small>}</p>
          <label className="check">
            <input type="checkbox" checked={makeList} onChange={(e) => setMakeList(e.target.checked)} />
            <span>{en.library.plMakePlaylist}</span>
          </label>
          {makeList && <label className="field"><span>{en.library.plName}</span><input type="text" {...noAutofill("youtube-playlist-name")} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 15 }} /></label>}
          <button type="button" className="btn inverse" onClick={() => void run(s.ids, { added: 0, existing: 0, failed: 0 })}>{en.library.plAdd(s.ids.length)}</button>
        </div>
      )}
      {s.step === "running" && (
        <div role="status">
          <p>{en.library.plAdding(Math.min(s.done + IMPORT_BATCH, s.ids.length), s.ids.length)}</p>
          <div className="bar"><i style={{ width: `${(s.done / s.ids.length) * 100}%` }} /></div>
        </div>
      )}
      {s.step === "done" && (
        <div role="status" className="yt-result">
          <p><strong>{en.library.plResult(s.added, s.existing)}</strong></p>
          {s.playlist && <p>{en.library.plPlaylistMade(s.playlist)}</p>}
          {s.failed > 0 && <p className="muted">{en.library.plFailed(s.failed)}</p>}
          {s.added + s.existing === 0 && s.notTried.length === 0 && <p className="muted">{en.library.plNone}</p>}
          {s.notTried.length > 0 && (
            <>
              <p className="yt-problem">{en.library.plNotTried(s.notTried.length)}</p>
              <button type="button" className="btn secondary" onClick={() => void run(s.notTried, { added: s.added, existing: s.existing, failed: s.failed })}>{en.library.plRetry}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
