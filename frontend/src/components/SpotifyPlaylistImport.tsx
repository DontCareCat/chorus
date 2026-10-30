import { useEffect, useRef, useState } from "react";
import { en } from "../i18n/en";
import { noAutofill } from "../lib/noAutofill";
import { IMPORT_BATCH, youtubeSearchUrl, youtubeThumb } from "../lib/youtube-add";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import type { SpotifyPlaylistDto, SpotifyTrackDto } from "../services/api";

interface Proposal { track: number; videoId: string | null; title: string; channel: string; picked: boolean }
type Step =
  | { step: "reading" }
  | { step: "error"; message: string; unreadable: boolean }
  | { step: "ready"; list: SpotifyPlaylistDto }
  | { step: "searching"; list: SpotifyPlaylistDto; done: number; total: number }
  | { step: "proposals"; list: SpotifyPlaylistDto; proposals: Proposal[]; problem: string | null }
  | { step: "working"; list: SpotifyPlaylistDto }
  | { step: "made"; list: SpotifyPlaylistDto; name: string; added: number; songs: number; problem: string | null };

/**
 * A public Spotify playlist, read from its link: the tracks that are songs in the library go into a Chorus playlist; for the others YouTube is
 * searched (with the person's key) and a video is proposed for each, to tick and add. Without a key the others are listed with a search link.
 */
export function SpotifyPlaylistImport({ link, onDone, onPaste }: { link: string; onDone: () => void; onPaste: () => void }) {
  const [state, setState] = useState<Step>({ step: "reading" });
  const [name, setName] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    let gone = false;
    setState({ step: "reading" });
    api.settings().then((c) => { if (!gone) setHasKey(c.youtube_api_key !== ""); }, () => undefined);
    api.spotifyPlaylist(link).then(
      (list) => { if (gone) return; setName(list.name || en.library.tlNameDefault); setState({ step: "ready", list }); },
      (e) => { if (!gone) setState({ step: "error", message: e instanceof ApiError ? e.message : en.errors.generic, unreadable: e instanceof ApiError && e.code === "spotify_page_unreadable" }); },
    );
    return () => { gone = true; };
  }, [link]);

  const missing = (list: SpotifyPlaylistDto): number[] => list.tracks.flatMap((t, i) => (t.song_id === null ? [i] : []));

  const search = async (list: SpotifyPlaylistDto) => {
    const todo = missing(list);
    const proposals: Proposal[] = [];
    let problem: string | null = null;
    for (const [n, i] of todo.entries()) {
      if (!alive.current) return;
      setState({ step: "searching", list, done: n, total: todo.length });
      const t = list.tracks[i]!;
      try {
        const hit = (await api.youtubeSearch(`${t.artist} ${t.title}`.trim())).hits[0];
        proposals.push({ track: i, videoId: hit?.video_id ?? null, title: hit?.title ?? "", channel: hit?.channel ?? "", picked: !!hit });
      } catch (e) {
        problem = e instanceof ApiError ? e.message : en.errors.generic;
        for (const rest of todo.slice(n)) proposals.push({ track: rest, videoId: null, title: "", channel: "", picked: false }); // the day's searches ran out, or the key was refused
        break;
      }
    }
    if (alive.current) setState({ step: "proposals", list, proposals, problem });
  };

  /** Adds the videos picked (named after the Spotify tracks) and makes the Chorus playlist in the track order. */
  const finish = async (list: SpotifyPlaylistDto, picked: Proposal[]) => {
    setState({ step: "working", list });
    const songOfTrack = new Map<number, number>();
    list.tracks.forEach((t, i) => { if (t.song_id !== null) songOfTrack.set(i, t.song_id); });
    let added = 0;
    let problem: string | null = null;
    const byVideo = new Map<string, number[]>();
    for (const p of picked) if (p.videoId) byVideo.set(p.videoId, [...(byVideo.get(p.videoId) ?? []), p.track]);
    const videos = [...byVideo.keys()];
    for (let at = 0; at < videos.length && problem === null; at += IMPORT_BATCH) {
      const batch = videos.slice(at, at + IMPORT_BATCH);
      const names = Object.fromEntries(batch.map((v) => { const t = list.tracks[byVideo.get(v)![0]!]!; return [v, { title: t.title, artist: t.artist.split(",")[0]!.trim() }]; }));
      try {
        const r = await api.importYouTubeVideos(batch, true, names);
        added += r.added;
        for (const s of r.songs) if (s.youtube_id) for (const track of byVideo.get(s.youtube_id) ?? []) songOfTrack.set(track, s.id);
        if (r.not_tried.length) problem = en.library.plNotTried(r.not_tried.length);
      } catch (e) {
        problem = e instanceof ApiError ? e.message : en.errors.generic;
      }
    }
    const ids = [...new Set(list.tracks.flatMap((_, i) => (songOfTrack.has(i) ? [songOfTrack.get(i)!] : [])))];
    let made: string | null = null;
    if (ids.length) {
      const base = Array.from(name.trim() || en.library.tlNameDefault).slice(0, 100).join("");
      for (let n = 1; n < 20 && made === null; n++) {
        const tryName = n === 1 ? base : `${base} (${n})`;
        let created;
        try {
          created = await api.createPlaylist(tryName);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) continue;
          problem ??= en.library.plNotMade;
          break;
        }
        try {
          await api.addToPlaylist(created.id, ids);
          made = tryName;
        } catch {
          void api.deletePlaylist(created.id).catch(() => undefined);
          problem ??= en.library.plNotMade;
          break;
        }
      }
      if (made === null) problem ??= en.library.plNotMade;
    }
    if (!alive.current) return;
    setState({ step: "made", list, name: made ?? name, added, songs: made ? ids.length : 0, problem });
    onDone();
  };

  const s = state;
  const list = s.step === "reading" || s.step === "error" ? null : s.list;
  const haveCount = list ? new Set(list.tracks.filter((t) => t.song_id !== null).map((t) => t.song_id)).size : 0;
  const otherCount = list ? missing(list).length : 0;
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

      {s.step === "ready" && (
        <div className="yt-found">
          <label className="field"><span>{en.library.plName}</span><input type="text" {...noAutofill("spotify-playlist-name")} value={name} onChange={(e) => setName(e.target.value)} style={{ fontSize: 15 }} /></label>
          {otherCount > 0 && hasKey && (
            <>
              <button type="button" className="btn inverse" onClick={() => void search(s.list)}>{en.library.spFindOthers(otherCount)}</button>
              <small>{en.library.spQuota(otherCount)}</small>
            </>
          )}
          {haveCount > 0 && <button type="button" className={otherCount > 0 && hasKey ? "btn secondary" : "btn inverse"} onClick={() => void finish(s.list, [])}>{en.library.spMakeOnly(haveCount)}</button>}
          {otherCount > 0 && !hasKey && <small>{en.library.ytNeedKey} <a href={paths.settings()}>{en.library.ytOpenSettings}</a></small>}
          {haveCount === 0 && otherCount === 0 && <p className="muted">{en.library.tlNone}</p>}
        </div>
      )}
      {s.step === "searching" && (
        <div role="status">
          <p>{en.library.spSearching(s.done, s.total)}</p>
          <div className="bar"><i style={{ width: `${(s.done / s.total) * 100}%` }} /></div>
        </div>
      )}
      {s.step === "proposals" && (
        <Proposals list={s.list} proposals={s.proposals} problem={s.problem} haveCount={haveCount} onFinish={(picked) => void finish(s.list, picked)} />
      )}
      {s.step === "working" && <p className="muted" role="status">{en.library.ytAdding}</p>}
      {s.step === "made" && (
        <div role="status" className="yt-result">
          {s.songs > 0 && <p><strong>{en.library.spMade(s.name, s.songs)}</strong></p>}
          {s.added > 0 && <p>{en.library.spAdded(s.added)}</p>}
          {s.problem && <p className="yt-problem" role="alert">{s.problem}</p>}
        </div>
      )}
      {s.step === "ready" && !hasKey && otherCount > 0 && <TrackLinks tracks={s.list.tracks} />}
    </div>
  );
}

function TrackLinks({ tracks }: { tracks: SpotifyTrackDto[] }) {
  const rest = tracks.filter((t) => t.song_id === null);
  return (
    <details className="sp-missing">
      <summary>{en.library.tlMissing(rest.length)}</summary>
      <ul>
        {rest.map((t, i) => (
          <li key={`${i}-${t.spotify_id}`}>
            <span>{[t.artist, t.title].filter(Boolean).join(" – ")}</span>
            <a href={youtubeSearchUrl(t.artist.split(",")[0] ?? "", t.title)} target="_blank" rel="noreferrer" aria-label={`${en.library.spFind}: ${t.artist} – ${t.title}`}>{en.library.spFind}</a>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Proposals({ list, proposals, problem, haveCount, onFinish }: { list: SpotifyPlaylistDto; proposals: Proposal[]; problem: string | null; haveCount: number; onFinish: (picked: Proposal[]) => void }) {
  const [rows, setRows] = useState(proposals);
  const picked = rows.filter((r) => r.picked && r.videoId);
  return (
    <div className="yt-found">
      <p><strong>{en.library.spProposals}</strong></p>
      {problem && <p className="yt-problem" role="alert">{problem}</p>}
      <ul className="yt-hits">
        {rows.map((r, n) => {
          const t = list.tracks[r.track]!;
          return (
            <li key={r.track}>
              {r.videoId ? <img src={youtubeThumb(r.videoId)} alt="" width={112} height={63} loading="lazy" /> : <span className="yt-nothumb" aria-hidden="true" />}
              <div className="yt-hit-text">
                <strong>{[t.artist, t.title].filter(Boolean).join(" – ")}</strong>
                <small>{r.videoId ? `${r.title} · ${r.channel}` : en.library.spNoVideo}</small>
              </div>
              {r.videoId && <input type="checkbox" className="pick" checked={r.picked} onChange={() => setRows((all) => all.map((x, k) => (k === n ? { ...x, picked: !x.picked } : x)))} aria-label={r.title} />}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn inverse" disabled={picked.length + haveCount === 0} onClick={() => onFinish(picked)}>
        {picked.length > 0 ? en.library.spAddAndMake(picked.length) : en.library.spMakeOnly(haveCount)}
      </button>
    </div>
  );
}
