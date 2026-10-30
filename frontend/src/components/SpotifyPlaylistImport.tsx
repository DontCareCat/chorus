import { useEffect, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { youtubeSearchUrl } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";
import type { SpotifyPlaylistDto } from "../services/api";
import { paths } from "../router";

type Step = { step: "reading" } | { step: "error"; message: string; setup: boolean } | { step: "ready"; list: SpotifyPlaylistDto } | { step: "made"; list: SpotifyPlaylistDto; name: string; songs: number; problem: string | null };

/** A public Spotify playlist: its tracks that are already songs in the library become a Chorus playlist; the others are listed so they can be found on YouTube. */
export function SpotifyPlaylistImport({ link, onMade }: { link: string; onMade: () => void }) {
  const [state, setState] = useState<Step>({ step: "reading" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    setState({ step: "reading" });
    api.spotifyPlaylist(link).then(
      (list) => { if (gone) return; setName(list.name || en.library.plNameDefault); setState({ step: "ready", list }); },
      (e) => { if (!gone) setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic, setup: e instanceof ApiError && e.code === "spotify_not_set_up" }); },
    );
    return () => { gone = true; };
  }, [link]);

  const make = async (list: SpotifyPlaylistDto) => {
    if (busy) return;
    setBusy(true);
    const ids = [...new Set(list.tracks.flatMap((t) => (t.song_id !== null ? [t.song_id] : [])))];
    const base = Array.from(name.trim() || en.library.plNameDefault).slice(0, 100).join("");
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
    setBusy(false);
    setState({ step: "made", list, name: made ?? base, songs: made ? ids.length : 0, problem });
    if (made) onMade();
  };

  const s = state;
  const missing = (list: SpotifyPlaylistDto) => list.tracks.filter((t) => t.song_id === null);
  return (
    <div className="yt-playlist sp-playlist">
      {s.step === "reading" && <p className="muted" role="status">{en.library.spReading}</p>}
      {s.step === "error" && (
        <p className="yt-problem" role="alert">
          {s.message} {s.setup && <a href={paths.settings()}>{en.library.spOpenSettings}</a>}
        </p>
      )}
      {(s.step === "ready" || s.step === "made") && (
        <>
          <p><strong>{s.list.name}</strong></p>
          <p>{en.library.spSummary(s.list.tracks.length, s.list.matched)}</p>
          {s.list.total > s.list.tracks.length && s.list.tracks.length >= 1000 && <small>{en.library.spTruncated(s.list.total)}</small>}
        </>
      )}
      {s.step === "ready" && (s.list.matched > 0 ? (
        <div className="yt-found">
          <label className="field"><span>{en.library.plName}</span><input type="text" {...noAutofill("spotify-playlist-name")} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 15 }} /></label>
          <button type="button" className="btn inverse" disabled={busy} onClick={() => void make(s.list)}>{en.library.spMakePlaylist(s.list.matched)}</button>
        </div>
      ) : <p className="muted">{en.library.spNoneMatched}</p>)}
      {s.step === "made" && (
        <div role="status" className="yt-result">
          {s.problem ? <p className="yt-problem" role="alert">{s.problem}</p> : <p><strong>{en.library.spMade(s.name, s.songs)}</strong></p>}
        </div>
      )}
      {(s.step === "ready" || s.step === "made") && missing(s.list).length > 0 && (
        <details className="sp-missing">
          <summary>{en.library.spMissing(missing(s.list).length)}</summary>
          <p className="muted">{en.library.spMissingHelp}</p>
          <ul>
            {missing(s.list).map((t) => (
              <li key={t.spotify_id}>
                <span>{t.artist} – {t.title}</span>
                <a href={youtubeSearchUrl(t.artist.split(",")[0] ?? "", t.title)} target="_blank" rel="noreferrer">{en.library.spFind}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
