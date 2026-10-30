import { useEffect, useRef, useState } from "react";
import { Cover } from "../components/Cover";
import { CoverPicker } from "../components/CoverPicker";
import { Details, Finder } from "../components/SongTools";
import { Icon } from "../components/Icon";
import { timecode } from "../game/lyric-window";
import { useAsync } from "../hooks/useAsync";
import { en } from "../i18n/en";
import { paths } from "../router";
import { api, ApiError } from "../services/api";
import { createYouTubeEngine } from "../services/audio/youtube-player";
import type { GameEngine } from "../services/audio/engine";
import type { LyricsDto, SongDto } from "../services/api";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : en.errors.generic);
type Notice = { kind: "ok" | "error"; text: string } | null;

export function SongPage({ songId }: { songId: number }) {
  const song = useAsync(() => api.songs().then((l) => l.find((s) => s.id === songId) ?? Promise.reject(new ApiError("song_not_found", "Song not found", 404))), [songId]);
  const lyrics = useAsync<LyricsDto | null>(() => api.lyrics(songId).catch((e: unknown) => (e instanceof ApiError && e.code === "no_lyrics" ? null : Promise.reject(e))), [songId]);

  if (song.error) return <p className="notice error">{song.error.message}</p>;
  if (!song.data) return <p className="muted">…</p>;
  const s = song.data;

  return (
    <>
      <a className="crumb" href={paths.library()}>← {en.song.back}</a>
      <div className="page-head with-cover">
        <Cover songId={s.id} title={s.title} hasCover={s.has_cover} youtubeId={s.youtube_id} size="xl" />
        <div>
          <h1>{s.title}</h1>
          <div className="song-meta">
            <span>{s.artist}</span>
            {s.album && <span>{s.album}</span>}
            <span className="lang">{s.language}</span>
          </div>
        </div>
      </div>
      <div className="two-col">
        <Timing song={s} lyrics={lyrics.data} onSaved={song.reload} />
        <div>
          <Finder song={s} hasLyrics={!!lyrics.data} onAttached={() => { lyrics.reload(); song.reload(); }} />
          <CoverPicker song={s} onChanged={song.reload} />
          <Details song={s} onSaved={song.reload} />
        </div>
      </div>
    </>
  );
}

/** Listen with the current lyrics highlighted; nudge the timing until the highlight matches the singing. */
function Timing({ song, lyrics, onSaved }: { song: SongDto; lyrics: LyricsDto | null; onSaved: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [offset, setOffset] = useState(song.lyrics_offset);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setOffset(song.lyrics_offset), [song.lyrics_offset]);
  // a YouTube song is heard in YouTube's own player, shown here (never covered)
  const youtubeId = song.source === "youtube" ? song.youtube_id ?? null : null;
  const ytHost = useRef<HTMLDivElement>(null);
  const [yt, setYt] = useState<GameEngine | null>(null);
  const [ytError, setYtError] = useState<string | null>(null);
  useEffect(() => {
    if (!youtubeId || !ytHost.current) return;
    let gone = false, made: GameEngine | null = null;
    createYouTubeEngine(ytHost.current, youtubeId).then(
      (e) => { if (gone) { e.dispose(); return; } made = e; setYt(e); e.onError(setYtError); e.onStateChange((st) => setPlaying(st === "playing" || st === "buffering")); },
      (err: Error) => { if (!gone) setYtError(err.message); },
    );
    return () => { gone = true; made?.dispose(); setYt(null); };
  }, [youtubeId, !!lyrics]); // the player's place exists once the lyrics have loaded
  const lengthSaved = useRef(false);
  useEffect(() => { // the player tells the video's length: keep it (it makes the lyrics match better)
    if (!yt || song.duration > 0 || lengthSaved.current) return;
    const t = setInterval(() => {
      const d = yt.getDuration();
      if (d > 0 && !lengthSaved.current) { lengthSaved.current = true; api.patchSong(song.id, { duration: Math.round(d) }).then(onSaved, () => { lengthSaved.current = false; }); }
    }, 1000);
    return () => clearInterval(t);
  }, [yt, song.id, song.duration]);
  useEffect(() => {
    const t = setInterval(() => setNow(yt ? yt.getCurrentTime() : audio.current?.currentTime ?? 0), 100);
    return () => clearInterval(t);
  }, [yt]);

  const lines = lyrics?.lines ?? [];
  // audioTime = lyricTime + offset (same convention as the game)
  const active = lyrics?.is_synced ? lines.findIndex((l) => l.start_time !== null && l.end_time !== null && now >= l.start_time + offset && now < l.end_time + offset) : -1;
  const nudge = (d: number) => setOffset((o) => Math.round((o + d) * 10) / 10);
  const save = async () => {
    try {
      await api.patchSong(song.id, { lyrics_offset: offset });
      setNotice({ kind: "ok", text: en.song.saved });
      onSaved();
    } catch (e) {
      setNotice({ kind: "error", text: msg(e) });
    }
  };
  const firstStart = lines.find((l) => l.start_time !== null)?.start_time ?? null;
  const syncStart = () => { if (firstStart !== null) setOffset(Math.min(60, Math.max(-60, Math.round((now - firstStart) * 10) / 10))); };
  const seekTo = (t: number) => {
    if (yt) { void yt.seek(t).then(() => yt.play()).catch(() => undefined); return; }
    if (audio.current) { audio.current.currentTime = t; void audio.current.play(); }
  };
  const toggle = () => {
    if (yt) { if (playing) yt.pause(); else void yt.play().catch(() => undefined); return; }
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  return (
    <section className="section">
      <h2>{en.song.currentLyrics}</h2>
      {!lyrics && <p className="muted">{en.song.noLyrics}</p>}
      {lyrics && (
        <>
          {youtubeId ? (
            <>
              <div className="yt-stage"><div className="yt-player" ref={ytHost} /></div>
              {ytError && <p className="notice error" role="alert">{ytError} <a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noreferrer">{en.game.openOnYouTube}</a></p>}
            </>
          ) : (
            <audio ref={audio} src={api.audioUrl(song.id)} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
          )}
          <div className="controls" style={{ gap: 12 }}>
            <button type="button" className="icon-btn big" onClick={toggle} aria-label={playing ? en.game.pause : en.game.play} title={playing ? en.game.pause : en.game.play}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <span className="transport-time" style={{ textAlign: "left" }}>{timecode(now)} / {timecode(yt && Number.isFinite(yt.getDuration()) ? yt.getDuration() : song.duration)}</span>
          </div>
          {lyrics.is_synced ? (
            <>
              <p className="muted" style={{ marginTop: 14 }}>{youtubeId ? en.song.youtubeSyncHelp : en.song.offsetHelp}</p>
              <div className="offset-row">
                <button type="button" className="btn secondary small" onClick={() => nudge(-0.1)}>{en.song.earlier}</button>
                <span className="offset-value" aria-live="polite">{offset > 0 ? "+" : ""}{offset.toFixed(1)} s</span>
                <button type="button" className="btn secondary small" onClick={() => nudge(0.1)}>{en.song.later}</button>
                {youtubeId && <button type="button" className="btn secondary small" onClick={syncStart} disabled={!yt || !playing || firstStart === null}>{en.song.syncStart}</button>}
                <button type="button" className="btn small" onClick={() => void save()} disabled={offset === song.lyrics_offset}>{en.song.saveOffset}</button>
              </div>
              {notice && <p className={`notice ${notice.kind}`} role="status">{notice.text}</p>}
            </>
          ) : (
            <p className="notice">{en.song.unsynced}</p>
          )}
          {lyrics.warnings.map((w) => <p className="notice" key={w}>{w}</p>)}
          <ol className="lyric-lines" aria-label="Lyrics">
            {lines.map((l, i) => (
              <li
                key={l.sequence}
                className="lyric-line"
                aria-current={i === active}
                onClick={() => { if (l.start_time !== null) seekTo(Math.max(0, l.start_time + offset)); }}
              >
                <time>{timecode(l.start_time)}</time>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
