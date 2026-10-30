import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { ClearableInput } from "./ClearableInput";
import { IMPORT_BATCH } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import { loadPlaylistVideoIds } from "../services/audio/youtube-player";

type Step =
  | { step: "reading" }
  | { step: "error"; message: string }
  | { step: "found"; ids: string[] }
  | { step: "running"; ids: string[]; done: number }
  | { step: "done"; added: number; existing: number; failed: number; notTried: string[]; playlist: string | null; problem: string | null };

/** Importing a public YouTube playlist: read its videos (YouTube's own player lists them, no key), add them a batch at a time, optionally into a Chorus playlist. */
export function YouTubePlaylistImport({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const [state, setState] = useState<Step>({ step: "reading" });
  const [name, setName] = useState<string>(en.library.plNameDefault);
  const [makeList, setMakeList] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const songIds = useRef<number[]>([]);
  const fresh = useRef<number[]>([]); // songs this import added: their lyrics are looked up once, at the end
  const alive = useRef(true);
  const running = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    const abort = new AbortController();
    songIds.current = [];
    fresh.current = [];
    setState({ step: "reading" });
    if (!host.current) return;
    api.youtubePlaylistTitle(listId).then((r) => { if (!abort.signal.aborted && r.title) setName((n) => (n === en.library.plNameDefault ? r.title : n)); }, () => undefined); // the original name is the suggested one
    loadPlaylistVideoIds(host.current, listId, abort.signal).then(
      (ids) => { if (!abort.signal.aborted) setState({ step: "found", ids }); },
      (e: Error) => { if (!abort.signal.aborted) setState({ step: "error", message: e.message }); },
    );
    return () => abort.abort();
  }, [listId]);

  const run = async (ids: string[], done: { added: number; existing: number; failed: number }) => {
    let { added, existing, failed } = done;
    for (let at = 0; at < ids.length; at += IMPORT_BATCH) {
      if (!alive.current) return; // the person left: what is added stays, nothing more is asked
      setState({ step: "running", ids, done: at });
      const batch = ids.slice(at, at + IMPORT_BATCH);
      let r;
      try {
        r = await api.importYouTubeVideos(batch, false);
      } catch (e) {
        if (!alive.current) return;
        setState({ step: "done", added, existing, failed, notTried: ids.slice(at), playlist: null, problem: e instanceof ApiError ? e.message : en.errors.generic });
        onAdded();
        return;
      }
      added += r.added; existing += r.existing; failed += r.failed.length;
      songIds.current.push(...r.songs.map((s) => s.id));
      fresh.current.push(...r.songs.filter((s) => s.lyrics_status === "pending").map((s) => s.id));
      if (r.not_tried.length) {
        if (!alive.current) return;
        setState({ step: "done", added, existing, failed, notTried: [...r.not_tried, ...ids.slice(at + IMPORT_BATCH)], playlist: null, problem: null });
        onAdded();
        return;
      }
    }
    if (!alive.current) return;
    if (fresh.current.length) void api.retryLyrics(fresh.current).catch(() => undefined); // one lookup queue for all the new songs
    fresh.current = [];
    let playlist: string | null = null;
    let problem: string | null = null;
    if (makeList && songIds.current.length) {
      const base = Array.from(name.trim() || en.library.plNameDefault).slice(0, 100).join("");
      for (let n = 1; n < 20 && playlist === null; n++) {
        const tryName = n === 1 ? base : `${base} (${n})`;
        let made;
        try {
          made = await api.createPlaylist(tryName);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) continue; // the name is taken, try the next
          problem = en.library.plNotMade;
          break;
        }
        try {
          await api.addToPlaylist(made.id, songIds.current);
          playlist = tryName;
        } catch {
          void api.deletePlaylist(made.id).catch(() => undefined); // no empty playlist is left behind
          problem = en.library.plNotMade;
          break;
        }
      }
    }
    if (!alive.current) return;
    setState({ step: "done", added, existing, failed, notTried: [], playlist, problem });
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
          {makeList && <label className="field"><span>{en.library.plName}</span><ClearableInput type="text" {...noAutofill("youtube-playlist-name")} value={name} onValue={setName} style={{ fontSize: 15 }} /></label>}
          <button type="button" className="btn inverse" onClick={() => { if (running.current) return; running.current = true; void run(s.ids, { added: 0, existing: 0, failed: 0 }).finally(() => { running.current = false; }); }}>{en.library.plAdd(s.ids.length)}</button>
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
          {s.problem && <p className="yt-problem" role="alert">{s.problem}</p>}
          {s.playlist && <p>{en.library.plPlaylistMade(s.playlist)}</p>}
          {s.failed > 0 && <p className="muted">{en.library.plFailed(s.failed)}</p>}
          {s.added + s.existing === 0 && s.notTried.length === 0 && <p className="muted">{en.library.plNone}</p>}
          {s.notTried.length > 0 && (
            <>
              <p className="yt-problem">{en.library.plNotTried(s.notTried.length)}</p>
              <button type="button" className="btn secondary" onClick={() => { if (running.current) return; running.current = true; void run(s.notTried, { added: s.added, existing: s.existing, failed: s.failed }).finally(() => { running.current = false; }); }}>{en.library.plRetry}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
