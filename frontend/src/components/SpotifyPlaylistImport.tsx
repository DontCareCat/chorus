import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { ClearableInput } from "./ClearableInput";
import { youtubeSearchUrl } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import type { SpotifyPlaylistDto } from "../services/api";

type Step =
  | { step: "reading" }
  | { step: "error"; message: string; unreadable: boolean }
  | { step: "ready"; list: SpotifyPlaylistDto }
  | { step: "made"; list: SpotifyPlaylistDto; name: string; songs: number; problem: string | null };

/**
 * A public Spotify playlist, read from its link: the tracks that are songs in the library go into a Chorus playlist; the others are listed with a
 * link to the YouTube search for each (the person pastes the video's link above; reading the playlist again then matches it).
 */
export function SpotifyPlaylistImport({ link, onDone, onPaste }: { link: string; onDone: () => void; onPaste: () => void }) {
  const [state, setState] = useState<Step>({ step: "reading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let gone = false;
    setState({ step: "reading" });
    const wait = setTimeout(() => api.spotifyPlaylist(link).then(
      (list) => { if (gone) return; setName(list.name || en.library.tlNameDefault); setState({ step: "ready", list }); },
      (e) => { if (!gone) setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic, unreadable: e instanceof ApiError && e.code === "spotify_page_unreadable" }); },
    ), 500); // typing a link does not read a page for every letter
    return () => { gone = true; clearTimeout(wait); };
  }, [link]);

  /** The Chorus playlist of the tracks that are songs in the library, in the playlist's order. */
  const make = async (list: SpotifyPlaylistDto) => {
    if (busy) return;
    setBusy(true);
    const ids = [...new Set(list.tracks.flatMap((t) => (t.song_id !== null ? [t.song_id] : [])))];
    const base = Array.from(name.trim() || en.library.tlNameDefault).slice(0, 100).join("");
    let made: string | null = null;
    let problem: string | null = null;
    for (let n = 1; n < 20 && made === null; n++) {
      const tryName = n === 1 ? base : `${base} (${n})`;
      let created;
      try {
        created = await api.createPlaylist(tryName);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue;
        problem = en.library.plNotMade;
        break;
      }
      try {
        await api.addToPlaylist(created.id, ids);
        made = tryName;
      } catch {
        void api.deletePlaylist(created.id).catch(() => undefined);
        problem = en.library.plNotMade;
        break;
      }
    }
    if (made === null) problem ??= en.library.plNotMade;
    setBusy(false);
    if (!alive.current) return;
    setState({ step: "made", list, name: made ?? base, songs: made ? ids.length : 0, problem });
    if (made) onDone();
  };

  const s = state;
  const list = s.step === "ready" || s.step === "made" ? s.list : null;
  const haveCount = list ? new Set(list.tracks.filter((t) => t.song_id !== null).map((t) => t.song_id)).size : 0;
  const rest = list ? list.tracks.filter((t) => t.song_id === null) : [];
  return (
    <div className="yt-playlist sp-playlist">
      {s.step === "reading" && <p className="muted" role="status">{en.library.spReading}</p>}
      {s.step === "error" && (
        <div role="alert">
          <p className="yt-problem">{s.message}</p>
          {s.unreadable && <button type="button" className="btn secondary small" onClick={onPaste}>{en.library.spUnreadableTitle}</button>}
        </div>
      )}
      {list && <p><strong>{list.name}</strong> <small className="muted">{list.owner}</small></p>}
      {list && <p role="status">{en.library.spSummary(list.tracks.length, haveCount)}{list.tracks.length >= 100 && <small> {en.library.spLimit}</small>}</p>}
      {s.step === "ready" && haveCount > 0 && (
        <div className="yt-found">
          <label className="field"><span>{en.library.plName}</span><ClearableInput type="text" {...noAutofill("spotify-playlist-name")} value={name} onValue={setName} style={{ fontSize: 15 }} /></label>
          <button type="button" className="btn inverse" disabled={busy} onClick={() => void make(s.list)}>{en.library.spMakeOnly(haveCount)}</button>
        </div>
      )}
      {s.step === "made" && (
        <div role="status" className="yt-result">
          {s.songs > 0 && <p><strong>{en.library.spMade(s.name, s.songs)}</strong></p>}
          {s.problem && <p className="yt-problem" role="alert">{s.problem}</p>}
        </div>
      )}
      {rest.length > 0 && (
        <details className="sp-missing" open={haveCount === 0}>
          <summary>{en.library.tlMissing(rest.length)}</summary>
          <p className="muted">{en.library.tlMissingHelp}</p>
          <ul>
            {rest.map((t, i) => (
              <li key={`${i}-${t.spotify_id}`}>
                <span>{[t.artist, t.title].filter(Boolean).join(" – ")}</span>
                <a href={youtubeSearchUrl(t.artist.split(",")[0] ?? "", t.title)} target="_blank" rel="noreferrer" aria-label={`${en.library.spFind}: ${t.artist} – ${t.title}`}>{en.library.spFind}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
