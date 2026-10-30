import { useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { parseTrackList } from "../lib/track-list";
import type { TrackRow } from "../lib/track-list";
import { youtubeSearchUrl } from "../lib/youtube-add";
import { api, ApiError } from "../services/api";

interface Checked { tracks: TrackRow[]; songIds: (number | null)[] }
type Step = { step: "edit" } | { step: "checking" } | { step: "error"; message: string } | { step: "ready"; list: Checked } | { step: "made"; list: Checked; name: string; songs: number; problem: string | null };

/**
 * A playlist the person brings as a list (Spotify no longer lets other apps read playlists, so: pasted lines or a CSV file exported from the
 * playlist). Tracks that are songs in the library make a Chorus playlist; the others are listed with a YouTube search link.
 */
export function TrackListImport({ spotify, onMade }: { spotify: boolean; onMade: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<Step>({ step: "edit" });
  const [name, setName] = useState<string>(en.library.tlNameDefault);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const check = async (raw: string) => {
    const tracks = parseTrackList(raw);
    if (tracks.length === 0) { setState({ step: "error", message: en.library.tlNone }); return; }
    setState({ step: "checking" });
    try {
      const r = await api.matchTracks(tracks);
      const songIds: (number | null)[] = tracks.map(() => null);
      for (const m of r.matches) songIds[m.index] = m.song_id;
      setState({ step: "ready", list: { tracks, songIds } });
    } catch (e) {
      setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic });
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const body = await file.text();
    setText(body);
    if (name === en.library.tlNameDefault) setName(file.name.replace(/\.[^.]+$/, "") || en.library.tlNameDefault);
    await check(body);
  };

  const make = async (list: Checked) => {
    if (busy) return;
    setBusy(true);
    const ids = [...new Set(list.songIds.filter((x): x is number => x !== null))];
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
    setBusy(false);
    setState({ step: "made", list, name: made ?? base, songs: made ? ids.length : 0, problem });
    if (made) onMade();
  };

  const s = state;
  const list = s.step === "ready" || s.step === "made" ? s.list : null;
  const have = list ? new Set(list.songIds.filter((x): x is number => x !== null)).size : 0;
  const missing = list ? list.tracks.filter((_, i) => list.songIds[i] === null) : [];
  return (
    <div className="yt-playlist tl-import">
      <p className="muted">{spotify ? en.library.tlSpotifyWhy : en.library.tlHelp}</p>
      <label className="field">
        <span>{en.library.tlList}</span>
        <textarea rows={5} {...noAutofill("track-list")} value={text} onChange={(e) => { setText(e.target.value); if (s.step !== "edit") setState({ step: "edit" }); }} placeholder={en.library.tlPlaceholder} style={{ fontSize: 15 }} />
      </label>
      <div className="inline">
        <button type="button" className="btn inverse" disabled={!text.trim() || s.step === "checking"} onClick={() => void check(text)}>{s.step === "checking" ? en.library.ytChecking : en.library.tlCheck}</button>
        <button type="button" className="btn secondary" onClick={() => fileInput.current?.click()}>{en.library.tlFile}</button>
        <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,text/*" hidden onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {s.step === "error" && <p className="yt-problem" role="alert">{s.message}</p>}
      {list && <p role="status"><strong>{en.library.tlSummary(list.tracks.length, have)}</strong></p>}
      {s.step === "ready" && (have > 0 ? (
        <div className="yt-found">
          <label className="field"><span>{en.library.plName}</span><input type="text" {...noAutofill("track-list-name")} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 15 }} /></label>
          <button type="button" className="btn inverse" disabled={busy} onClick={() => void make(s.list)}>{en.library.tlMake(have)}</button>
        </div>
      ) : <p className="muted">{en.library.tlNoneMatched}</p>)}
      {s.step === "made" && (s.problem ? <p className="yt-problem" role="alert">{s.problem}</p> : <p role="status"><strong>{en.library.tlMade(s.name, s.songs)}</strong></p>)}
      {missing.length > 0 && (
        <details className="sp-missing">
          <summary>{en.library.tlMissing(missing.length)}</summary>
          <p className="muted">{en.library.tlMissingHelp}</p>
          <ul>
            {missing.map((t, i) => (
              <li key={`${i}-${t.artist}-${t.title}`}>
                <span>{[t.artist, t.title].filter(Boolean).join(" – ")}</span>
                <a href={youtubeSearchUrl(t.artist, t.title)} target="_blank" rel="noreferrer">{en.library.spFind}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
