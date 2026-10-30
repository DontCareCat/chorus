import { useEffect, useState } from "react";
import { en } from "../i18n/en";
import { youtubeSearchUrl, youtubeThumb } from "../lib/youtube-add";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { SearchHitDto, SongDto } from "../services/api";

type State = { step: "searching" } | { step: "error"; message: string; code: string } | { step: "hits"; hits: SearchHitDto[] };

/** Videos for "artist and name" (YouTube Data API with the person's key); each can be added as it is, the title and artist are cleaned as for a link. */
export function YouTubeSearch({ query, onAdded, onShow, names }: { query: string; onAdded: (song: SongDto) => void; onShow: (title: string) => void; names?: { title: string; artist: string } }) {
  const [state, setState] = useState<State>({ step: "searching" });
  const [added, setAdded] = useState<Record<string, SongDto>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    setState({ step: "searching" });
    setProblem(null);
    api.youtubeSearch(query).then(
      (r) => { if (!gone) setState({ step: "hits", hits: r.hits }); },
      (e) => { if (!gone) setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic, code: e instanceof ApiError ? e.code : "" }); },
    );
    return () => { gone = true; };
  }, [query]);

  const add = async (hit: SearchHitDto) => {
    if (busy) return;
    setBusy(hit.video_id);
    setProblem(null);
    try {
      const song = await api.addYouTubeSong(hit.video_id, names?.title, names?.artist);
      setAdded((a) => ({ ...a, [hit.video_id]: song }));
      onAdded(song);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : en.errors.generic);
    } finally {
      setBusy(null);
    }
  };

  const s = state;
  return (
    <div className="yt-search" aria-live="polite">
      {s.step === "searching" && <p className="muted" role="status">{en.library.ytSearching}</p>}
      {s.step === "error" && (
        <div role="alert">
          <p className="yt-problem">{s.code === "youtube_key_missing" ? en.library.ytNeedKey : s.message}</p>
          <p>
            {(s.code === "youtube_key_missing" || s.code === "youtube_key_invalid") && <a href={paths.settings()}>{en.library.ytOpenSettings}</a>}{" "}
            <a href={youtubeSearchUrl("", query)} target="_blank" rel="noreferrer">{en.library.ytSearchOnYouTube}</a>
          </p>
        </div>
      )}
      {s.step === "hits" && s.hits.length === 0 && <p className="muted">{en.library.ytNoHits}</p>}
      {s.step === "hits" && s.hits.length > 0 && (
        <ul className="yt-hits">
          {s.hits.map((h) => (
            <li key={h.video_id}>
              <img src={youtubeThumb(h.video_id)} alt="" width={112} height={63} loading="lazy" />
              <div className="yt-hit-text"><strong>{h.title}</strong><small>{h.channel}</small></div>
              {added[h.video_id] ? <span className="muted">{en.library.ytHitAdded}</span>
                : h.existing_id !== null ? <button type="button" className="btn secondary small" onClick={() => onShow(h.title)}>{en.library.ytHitHave}</button>
                : <button type="button" className="btn inverse small" disabled={busy !== null} onClick={() => void add(h)}>{busy === h.video_id ? en.library.ytAdding : en.library.ytHitAdd}</button>}
            </li>
          ))}
        </ul>
      )}
      {problem && <p className="yt-problem" role="alert">{problem}</p>}
    </div>
  );
}
